package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"mime"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsConfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/mdp/qrterminal/v3"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	_ "modernc.org/sqlite"

	"go.mau.fi/whatsmeow"
	waE2E "go.mau.fi/whatsmeow/proto/waE2E"
	waHistorySync "go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
)

const (
	messageRetentionWindow      = 30 * 24 * time.Hour
	defaultConfigPath           = "./config.jsonc"
	defaultDatabaseSyncInterval = 30 * time.Second
	databaseSyncTimeout         = 2 * time.Minute
	groupMetadataSyncTimeout = 60 * time.Minute
	// Space group IQ calls conservatively to avoid WhatsApp 429 rate-overlimit bans.
	groupIQMinInterval         = 10 * time.Second
	groupIQRateLimitCooldown     = 30 * time.Minute
	groupRosterFreshFor        = 24 * time.Hour
	eventPersistTimeout        = 45 * time.Second
	eventPersistQueueSize      = 2048
	mediaUploadTimeout         = 2 * time.Minute
	objectDeleteTimeout        = 30 * time.Second
	mediaUploadWorkerCount     = 4
	mediaUploadQueueSize       = 256
	objectDeleteQueueSize      = 256
	defaultR2DatabaseObjectKey = "whatsapp.sqlite"
	defaultR2MediaPrefix       = "media"
)

var errGroupIQCoolingDown = errors.New("group IQ cooling down after rate-overlimit")

// main starts the long-running WhatsApp sync daemon.
// Example: `go run . -config ./config.jsonc`
func main() {
	config, err := parseConfig()
	if err != nil {
		log.Fatal(err)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	if err := run(ctx, config); err != nil && !errors.Is(err, context.Canceled) {
		log.Fatal(err)
	}
}

// run opens SQLite, initializes WhatsApp, and blocks until shutdown.
// Example: `if err := run(ctx, config); err != nil { log.Fatal(err) }`
func run(ctx context.Context, config daemonConfig) error {
	if err := config.validate(); err != nil {
		return err
	}

	dbPath, err := config.resolvePath(config.DatabasePath)
	if err != nil {
		return fmt.Errorf("resolve database path: %w", err)
	}

	db, err := openDatabase(dbPath)
	if err != nil {
		return err
	}
	defer db.Close()

	if err := ensureSchema(ctx, db); err != nil {
		return err
	}

	dbLog := waLog.Stdout("WA-DB", "WARN", true)
	storeContainer := sqlstore.NewWithDB(db, "sqlite", dbLog)
	if err := storeContainer.Upgrade(ctx); err != nil {
		return fmt.Errorf("upgrade whatsmeow store: %w", err)
	}

	deviceStore, err := storeContainer.GetFirstDevice(ctx)
	if err != nil {
		return fmt.Errorf("get device store: %w", err)
	}

	if deviceStore.PushName == "" {
		deviceStore.PushName = config.PushName
	}

	clientLog := waLog.Stdout("WA", "INFO", true)
	client := whatsmeow.NewClient(deviceStore, clientLog)

	r2Manager, err := newR2Manager(ctx, r2ManagerConfig{
		AccessKeyID:       config.R2AccessKeyID,
		Bucket:            config.R2Bucket,
		DatabaseObjectKey: config.R2DatabaseObjectKey,
		DatabasePath:      dbPath,
		Endpoint:          config.r2Endpoint(),
		SecretAccessKey:   config.R2SecretAccessKey,
		MediaPrefix:       config.R2MediaPrefix,
		SyncInterval:      config.databaseSyncInterval(),
	})
	if err != nil {
		return err
	}

	postgres, err := newPostgresChatsSync(ctx, config.PostgresDatabaseURL)
	if err != nil {
		return err
	}

	daemon := &daemon{
		client:           client,
		db:               db,
		r2:               r2Manager,
		postgres:         postgres,
		fatalEvents:      make(chan error, 1),
		eventPersistJobs: make(chan eventPersistJob, eventPersistQueueSize),
	}
	daemon.startEventPersistWorker()
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), databaseSyncTimeout)
		defer cancel()
		if err := daemon.shutdown(shutdownCtx); err != nil {
			log.Printf("shutdown R2 workers failed: %v", err)
		}
	}()

	if err := daemon.syncAllNamedChats(ctx); err != nil {
		return err
	}

	if err := daemon.deleteExpiredMessages(ctx, time.Now()); err != nil {
		return err
	}

	client.AddEventHandler(daemon.handleEvent)

	if client.Store.ID == nil {
		qrChan, err := client.GetQRChannel(ctx)
		if err != nil {
			return fmt.Errorf("create QR channel: %w", err)
		}

		go daemon.consumeQRCodes(qrChan)
		log.Printf("no existing session found, scan the QR code below with WhatsApp")
	} else {
		log.Printf("using existing WhatsApp session from %s", dbPath)
	}

	if err := client.Connect(); err != nil {
		return fmt.Errorf("connect WhatsApp client: %w", err)
	}

	log.Printf("daemon is running, syncing into %s", dbPath)

	select {
	case <-ctx.Done():
		client.Disconnect()
		return nil
	case err := <-daemon.fatalEvents:
		client.Disconnect()
		return err
	}
}

// parseConfig reads the daemon config path flag and loads the JSONC file.
// Example: `config, err := parseConfig()`
func parseConfig() (daemonConfig, error) {
	var configPath string

	flag.StringVar(&configPath, "config", defaultConfigPath, "Path to the daemon JSONC config file")
	flag.Parse()

	config, err := loadConfig(configPath)
	if err != nil {
		return daemonConfig{}, err
	}

	return config, nil
}

// loadConfig reads and parses the JSONC daemon config file.
// Example: `config, err := loadConfig("./config.jsonc")`
func loadConfig(path string) (daemonConfig, error) {
	absolutePath, err := filepath.Abs(strings.TrimSpace(path))
	if err != nil {
		return daemonConfig{}, fmt.Errorf("resolve config path: %w", err)
	}

	data, err := os.ReadFile(absolutePath)
	if err != nil {
		return daemonConfig{}, fmt.Errorf("read config file %s: %w", absolutePath, err)
	}

	var config daemonConfig
	if err := json.Unmarshal(stripJSONCComments(data), &config); err != nil {
		return daemonConfig{}, fmt.Errorf("parse config file %s: %w", absolutePath, err)
	}

	config.configDirectory = filepath.Dir(absolutePath)
	config.DatabasePath = strings.TrimSpace(config.DatabasePath)
	config.PostgresDatabaseURL = strings.TrimSpace(config.PostgresDatabaseURL)
	config.PushName = strings.TrimSpace(config.PushName)
	config.DatabaseSyncInterval = strings.TrimSpace(config.DatabaseSyncInterval)
	config.R2Endpoint = strings.TrimSpace(config.R2Endpoint)
	config.R2Bucket = strings.TrimSpace(config.R2Bucket)
	config.R2AccessKeyID = strings.TrimSpace(config.R2AccessKeyID)
	config.R2SecretAccessKey = strings.TrimSpace(config.R2SecretAccessKey)
	config.R2DatabaseObjectKey = strings.Trim(strings.TrimSpace(config.R2DatabaseObjectKey), "/")
	config.R2MediaPrefix = strings.Trim(strings.TrimSpace(config.R2MediaPrefix), "/")

	if config.PushName == "" {
		config.PushName = "Blissbase Sync"
	}

	if config.DatabaseSyncInterval == "" {
		config.DatabaseSyncInterval = defaultDatabaseSyncInterval.String()
	}

	if config.R2DatabaseObjectKey == "" {
		config.R2DatabaseObjectKey = defaultR2DatabaseObjectKey
	}

	if config.R2MediaPrefix == "" {
		config.R2MediaPrefix = defaultR2MediaPrefix
	}

	return config, nil
}

// openDatabase opens the shared SQLite database with the pragmas required by whatsmeow.
// Example: `db, err := openDatabase("./whatsapp.sqlite")`
func openDatabase(path string) (*sql.DB, error) {
	dsn := sqliteDSN(path)

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite database: %w", err)
	}

	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)

	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping sqlite database: %w", err)
	}

	return db, nil
}

// sqliteDSN builds a modernc SQLite DSN with the pragmas required by the session store.
// Example: `dsn := sqliteDSN("./whatsapp.sqlite")`
func sqliteDSN(path string) string {
	fileURL := &url.URL{
		Scheme: "file",
		Path:   path,
	}

	query := url.Values{}
	query.Add("_pragma", "foreign_keys(1)")
	query.Add("_pragma", "journal_mode(WAL)")
	query.Add("_pragma", "busy_timeout(30000)")
	fileURL.RawQuery = query.Encode()

	return fileURL.String()
}

// ensureSchema creates the application-specific tables used for message extraction.
// Example: `if err := ensureSchema(ctx, db); err != nil { return err }`
func ensureSchema(ctx context.Context, db *sql.DB) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS sync_chats (
			chat_jid TEXT PRIMARY KEY,
			display_name TEXT,
			username TEXT,
			last_message_timestamp INTEGER,
			unread_count INTEGER NOT NULL DEFAULT 0,
			archived INTEGER NOT NULL DEFAULT 0,
			raw_conversation_json TEXT,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS sync_messages (
			chat_jid TEXT NOT NULL,
			message_id TEXT NOT NULL,
			sender_jid TEXT NOT NULL,
			sender_phone_number TEXT,
			server_id INTEGER,
			timestamp INTEGER NOT NULL,
			is_from_me INTEGER NOT NULL,
			is_group INTEGER NOT NULL,
			push_name TEXT,
			message_type TEXT,
			category TEXT,
			media_type TEXT,
			media_mime_type TEXT,
			media_path TEXT,
			media_sha256 TEXT,
			text_value TEXT,
			raw_message_json TEXT,
			source_web_message_json TEXT,
			source TEXT NOT NULL,
			is_edit INTEGER NOT NULL DEFAULT 0,
			is_ephemeral INTEGER NOT NULL DEFAULT 0,
			is_view_once INTEGER NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL,
			PRIMARY KEY (chat_jid, message_id)
		)`,
		`CREATE INDEX IF NOT EXISTS sync_messages_timestamp_idx
			ON sync_messages(timestamp)`,
		`CREATE INDEX IF NOT EXISTS sync_messages_sender_idx
			ON sync_messages(sender_jid)`,
		`CREATE TABLE IF NOT EXISTS groups (
			group_jid TEXT PRIMARY KEY,
			name TEXT,
			topic TEXT,
			owner_jid TEXT,
			owner_phone TEXT,
			created_at INTEGER,
			creator_country_code TEXT,
			is_locked INTEGER NOT NULL DEFAULT 0,
			is_announce INTEGER NOT NULL DEFAULT 0,
			is_ephemeral INTEGER NOT NULL DEFAULT 0,
			disappearing_timer INTEGER,
			is_incognito INTEGER NOT NULL DEFAULT 0,
			is_parent INTEGER NOT NULL DEFAULT 0,
			linked_parent_jid TEXT,
			is_default_sub INTEGER NOT NULL DEFAULT 0,
			membership_approval_required INTEGER NOT NULL DEFAULT 0,
			member_add_mode TEXT,
			addressing_mode TEXT,
			participant_count INTEGER,
			participant_version_id TEXT,
			suspended INTEGER NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS contacts (
			contact_jid TEXT PRIMARY KEY,
			phone_number TEXT,
			lid_jid TEXT,
			first_name TEXT,
			full_name TEXT,
			push_name TEXT,
			business_name TEXT,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS contacts_phone_number_idx
			ON contacts(phone_number)`,
		`CREATE INDEX IF NOT EXISTS contacts_lid_jid_idx
			ON contacts(lid_jid)`,
		`CREATE TABLE IF NOT EXISTS group_contacts (
			group_jid TEXT NOT NULL,
			contact_jid TEXT NOT NULL,
			phone_number TEXT,
			lid_jid TEXT,
			is_admin INTEGER NOT NULL DEFAULT 0,
			is_super_admin INTEGER NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL,
			PRIMARY KEY (group_jid, contact_jid),
			FOREIGN KEY (group_jid) REFERENCES groups(group_jid) ON DELETE CASCADE,
			FOREIGN KEY (contact_jid) REFERENCES contacts(contact_jid) ON DELETE CASCADE
		)`,
		`CREATE INDEX IF NOT EXISTS group_contacts_contact_jid_idx
			ON group_contacts(contact_jid)`,
		`CREATE INDEX IF NOT EXISTS group_contacts_phone_number_idx
			ON group_contacts(phone_number)`,
	}

	for _, statement := range statements {
		if _, err := db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("create schema statement failed: %w", err)
		}
	}

	optionalColumns := []string{
		`ALTER TABLE sync_messages ADD COLUMN sender_phone_number TEXT`,
		`ALTER TABLE sync_messages ADD COLUMN media_mime_type TEXT`,
		`ALTER TABLE sync_messages ADD COLUMN media_path TEXT`,
		`ALTER TABLE sync_messages ADD COLUMN media_sha256 TEXT`,
	}

	for _, statement := range optionalColumns {
		if err := execIgnoringDuplicateColumn(ctx, db, statement); err != nil {
			return err
		}
	}

	return nil
}

// consumeQRCodes prints QR codes and pairing status changes for a fresh session.
// Example: `go daemon.consumeQRCodes(qrChan)`
func (d *daemon) consumeQRCodes(qrChan <-chan whatsmeow.QRChannelItem) {
	for item := range qrChan {
		switch item.Event {
		case "code":
			fmt.Println()
			qrterminal.GenerateHalfBlock(item.Code, qrterminal.L, os.Stdout)
			fmt.Println()
		case "success":
			log.Printf("QR pairing succeeded")
		case "timeout":
			d.notifyFatal(errors.New("QR pairing timed out before the device was linked"))
			return
		case "err-client-outdated":
			d.notifyFatal(errors.New("QR pairing failed because the client version is outdated"))
			return
		case "err-unexpected-state":
			d.notifyFatal(errors.New("QR pairing entered an unexpected state"))
			return
		case "error":
			if item.Error != nil {
				d.notifyFatal(fmt.Errorf("QR pairing failed: %w", item.Error))
				return
			}

			d.notifyFatal(errors.New("QR pairing failed with an unknown error"))
			return
		default:
			log.Printf("QR event: %s", item.Event)
		}
	}
}

// handleEvent persists messages and reacts to connection lifecycle events.
// Example: `client.AddEventHandler(daemon.handleEvent)`
func (d *daemon) handleEvent(evt any) {
	switch event := evt.(type) {
	case *events.Message:
		// Keep the pointer alive in the queued closure; never block the WA event loop.
		messageEvent := event
		d.enqueueEventPersist(`message`, func(ctx context.Context) error {
			return d.storeMessage(ctx, messageEvent, "realtime")
		})
	case *events.HistorySync:
		historyEvent := event
		d.enqueueEventPersist(`history_sync`, func(ctx context.Context) error {
			return d.storeHistorySync(ctx, historyEvent)
		})
	case *events.Connected:
		log.Printf("connected as %s", d.client.Store.ID)
		// Defer heavy group IQ work to OfflineSyncCompleted when possible.
		// Only kick contacts here; group backfill runs after offline sync finishes.
		d.backfillContactDisplayNamesAsync()
	case *events.OfflineSyncCompleted:
		d.backfillGroupDisplayNamesAsync()
		d.backfillContactDisplayNamesAsync()
	case *events.JoinedGroup:
		joinedEvent := *event
		d.enqueueEventPersist(`joined_group`, func(ctx context.Context) error {
			return d.storeJoinedGroup(ctx, &joinedEvent)
		})
	case *events.GroupInfo:
		groupEvent := *event
		d.enqueueEventPersist(`group_info`, func(ctx context.Context) error {
			return d.storeGroupInfoChange(ctx, &groupEvent)
		})
	case *events.Contact:
		contactEvent := *event
		d.enqueueEventPersist(`contact`, func(ctx context.Context) error {
			return d.storeContactChange(ctx, &contactEvent)
		})
	case *events.PushName:
		pushEvent := *event
		d.enqueueEventPersist(`push_name`, func(ctx context.Context) error {
			return d.storePushNameChange(ctx, &pushEvent)
		})
	case *events.BusinessName:
		businessEvent := *event
		d.enqueueEventPersist(`business_name`, func(ctx context.Context) error {
			return d.storeBusinessNameChange(ctx, &businessEvent)
		})
	case *events.Disconnected:
		log.Printf("disconnected from WhatsApp, waiting for automatic reconnect")
	case *events.KeepAliveTimeout:
		log.Printf("keepalive timed out (%d failures)", event.ErrorCount)
		if event.ErrorCount >= 3 {
			d.client.ResetConnection()
		}
	case *events.LoggedOut:
		d.notifyFatal(fmt.Errorf("WhatsApp session logged out: %s", event.Reason))
	case *events.StreamReplaced:
		d.notifyFatal(errors.New("WhatsApp stream was replaced by another client"))
	}
}

// startEventPersistWorker starts the serial background worker for event DB writes.
// Example: `d.startEventPersistWorker()`
func (d *daemon) startEventPersistWorker() {
	if d == nil || d.eventPersistJobs == nil {
		return
	}

	d.eventPersistWG.Add(1)
	go d.runEventPersistWorker()
}

// enqueueEventPersist queues DB work so the WhatsApp event loop never blocks on SQLite/Postgres.
// Example: `d.enqueueEventPersist("group_info", func(ctx context.Context) error { return d.storeGroupInfoChange(ctx, evt) })`
func (d *daemon) enqueueEventPersist(name string, run func(ctx context.Context) error) {
	if d == nil || run == nil || d.eventPersistJobs == nil {
		return
	}

	job := eventPersistJob{name: name, run: run}
	select {
	case d.eventPersistJobs <- job:
	default:
		log.Printf("drop event persist job %s: queue is saturated (%d)", name, eventPersistQueueSize)
	}
}

// runEventPersistWorker applies queued event writes one-at-a-time with a hard timeout.
// Example: `go d.runEventPersistWorker()`
func (d *daemon) runEventPersistWorker() {
	defer d.eventPersistWG.Done()

	for job := range d.eventPersistJobs {
		ctx, cancel := context.WithTimeout(context.Background(), eventPersistTimeout)
		started := time.Now()
		err := job.run(ctx)
		elapsed := time.Since(started).Round(time.Millisecond)
		cancel()

		if err != nil {
			log.Printf("event persist %s failed after %s: %v", job.name, elapsed, err)
			continue
		}
		if elapsed > 5*time.Second {
			log.Printf("event persist %s slow: %s", job.name, elapsed)
		}
	}
}

// stopEventPersistWorker closes the persist queue and waits for in-flight jobs.
// Example: `d.stopEventPersistWorker()`
func (d *daemon) stopEventPersistWorker() {
	if d == nil || d.eventPersistJobs == nil {
		return
	}

	d.eventPersistStop.Do(func() {
		close(d.eventPersistJobs)
		d.eventPersistWG.Wait()
	})
}

// notifyFatal reports a non-recoverable daemon error without blocking the event loop.
// Example: `d.notifyFatal(errors.New("session logged out"))`
func (d *daemon) notifyFatal(err error) {
	select {
	case d.fatalEvents <- err:
	default:
	}
}

// storeHistorySync stores chat metadata and parsed history-sync messages.
// Example: `if err := d.storeHistorySync(ctx, evt); err != nil { return err }`
func (d *daemon) storeHistorySync(ctx context.Context, evt *events.HistorySync) error {
	if evt == nil || evt.Data == nil {
		return nil
	}

	for _, conversation := range evt.Data.GetConversations() {
		if err := d.storeConversation(ctx, conversation); err != nil {
			log.Printf("store chat metadata failed: %v", err)
		}

		chatJID, err := types.ParseJID(conversation.GetID())
		if err != nil {
			log.Printf("skip history sync conversation %q: %v", conversation.GetID(), err)
			continue
		}

		for _, historyMessage := range conversation.GetMessages() {
			webMessage := historyMessage.GetMessage()
			if webMessage == nil {
				continue
			}

			messageEvent, err := d.client.ParseWebMessage(chatJID, webMessage)
			if err != nil {
				log.Printf("skip history message in %s: %v", chatJID, err)
				continue
			}

			if err := d.storeMessage(ctx, messageEvent, "history_sync"); err != nil {
				log.Printf("store history message failed: %v", err)
			}
		}
	}

	return nil
}

// storeConversation upserts chat metadata from a WhatsApp history sync.
// Example: `if err := d.storeConversation(ctx, conv); err != nil { return err }`
func (d *daemon) storeConversation(ctx context.Context, conversation *waHistorySync.Conversation) error {
	if conversation == nil {
		return nil
	}

	chatJID, err := types.ParseJID(conversation.GetID())
	if err != nil {
		return fmt.Errorf("parse chat jid: %w", err)
	}

	now := time.Now().Unix()
	displayName := firstNonEmpty(
		conversation.GetDisplayName(),
		conversation.GetName(),
		conversation.GetUsername(),
	)
	if displayName == "" && isDirectChatJID(chatJID) {
		displayName = d.resolveDirectChatDisplayName(ctx, chatJID)
	}

	lastTimestamp := int64(conversation.GetConversationTimestamp())
	if lastTimestamp == 0 {
		lastTimestamp = int64(conversation.GetLastMsgTimestamp())
	}

	_, err = d.db.ExecContext(
		ctx,
		`INSERT INTO sync_chats (
			chat_jid,
			display_name,
			username,
			last_message_timestamp,
			unread_count,
			archived,
			raw_conversation_json,
			updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(chat_jid) DO UPDATE SET
			display_name = COALESCE(excluded.display_name, sync_chats.display_name),
			username = COALESCE(excluded.username, sync_chats.username),
			last_message_timestamp = CASE
				WHEN excluded.last_message_timestamp IS NULL THEN sync_chats.last_message_timestamp
				WHEN sync_chats.last_message_timestamp IS NULL THEN excluded.last_message_timestamp
				WHEN excluded.last_message_timestamp > sync_chats.last_message_timestamp THEN excluded.last_message_timestamp
				ELSE sync_chats.last_message_timestamp
			END,
			unread_count = excluded.unread_count,
			archived = excluded.archived,
			raw_conversation_json = COALESCE(excluded.raw_conversation_json, sync_chats.raw_conversation_json),
			updated_at = excluded.updated_at`,
		chatJID.String(),
		nilIfEmpty(displayName),
		nilIfEmpty(conversation.GetUsername()),
		nilIfZero(lastTimestamp),
		conversation.GetUnreadCount(),
		boolToInt(conversation.GetArchived()),
		marshalProtoJSON(conversation),
		now,
	)
	if err != nil {
		return fmt.Errorf("upsert chat metadata: %w", err)
	}

	d.notifyDatabaseChanged()
	d.syncChatToPostgres(chatJID.String())

	return nil
}

// backfillGroupDisplayNamesAsync refreshes stored group names without blocking the event loop.
// Example: `d.backfillGroupDisplayNamesAsync()`
func (d *daemon) backfillGroupDisplayNamesAsync() {
	if d == nil || d.client == nil {
		return
	}

	d.groupMetadataSyncPending.Store(true)
	go d.runGroupMetadataSync()
}

// runGroupMetadataSync drains pending group metadata backfill requests.
// Example: `go d.runGroupMetadataSync()`
func (d *daemon) runGroupMetadataSync() {
	if !d.groupMetadataSyncRunning.CompareAndSwap(false, true) {
		return
	}
	defer d.groupMetadataSyncRunning.Store(false)

	for d.groupMetadataSyncPending.CompareAndSwap(true, false) {
		ctx, cancel := context.WithTimeout(context.Background(), groupMetadataSyncTimeout)
		err := d.backfillGroupDisplayNames(ctx)
		cancel()
		if err != nil {
			log.Printf("backfill group display names failed: %v", err)
		}
	}

	// A request may have arrived after the last CAS failed but before running was cleared.
	if d.groupMetadataSyncPending.Load() {
		go d.runGroupMetadataSync()
	}
}

// backfillGroupDisplayNames fetches all joined groups and syncs names, metadata, and memberships.
// Example: `if err := d.backfillGroupDisplayNames(ctx); err != nil { return err }`
func (d *daemon) backfillGroupDisplayNames(ctx context.Context) error {
	if d == nil || d.client == nil {
		return nil
	}

	// One list IQ only. Prefer that payload over per-group GetGroupInfo to avoid bans.
	groups, err := d.client.GetJoinedGroups(ctx)
	if err != nil {
		return fmt.Errorf("get joined groups: %w", err)
	}

	log.Printf("backfill groups: GetJoinedGroups returned %d groups (no bulk GetGroupInfo)", len(groups))

	stored := 0
	skippedRoster := 0
	for i, group := range groups {
		if group == nil || group.JID.IsEmpty() {
			continue
		}

		log.Printf(
			"backfill groups: [%d/%d] %s (%s, participants=%d)",
			i+1,
			len(groups),
			group.JID,
			group.Name,
			len(group.Participants),
		)
		result, err := d.syncGroupFromJoinedList(ctx, group)
		if err != nil {
			if errors.Is(err, errGroupIQCoolingDown) {
				log.Printf("backfill groups: stopping early to respect rate limits: %v", err)
				return nil
			}
			log.Printf("store group metadata for %s failed: %v", group.JID, err)
			continue
		}
		stored++
		if result.skippedRoster {
			skippedRoster++
		}
	}

	log.Printf(
		"backfill groups: done (stored=%d skipped_roster_rewrite=%d extra_group_info_calls_avoided=community+chats)",
		stored,
		skippedRoster,
	)
	return nil
}

// syncGroupFromJoinedList stores a group using GetJoinedGroups data and only fetches
// GetGroupInfo when the list payload has no participants and local roster is empty.
// Example: `result, err := d.syncGroupFromJoinedList(ctx, group)`
func (d *daemon) syncGroupFromJoinedList(ctx context.Context, group *types.GroupInfo) (groupSyncResult, error) {
	if group == nil || group.JID.IsEmpty() {
		return groupSyncResult{}, nil
	}

	groupJID := group.JID.ToNonAD().String()
	localCount, localUpdatedAt, hasLocal := d.localGroupRosterState(ctx, groupJID)

	// Prefer WhatsApp's joined-list participants — no extra IQ.
	if len(group.Participants) > 0 {
		if hasLocal && d.rosterLooksFresh(localCount, localUpdatedAt, len(group.Participants)) {
			log.Printf(
				"backfill groups: skip roster rewrite for %s (local=%d list=%d updated_at=%d)",
				groupJID,
				localCount,
				len(group.Participants),
				localUpdatedAt,
			)
			return groupSyncResult{skippedRoster: true}, d.persistGroupMetadata(ctx, group, false)
		}
		return groupSyncResult{}, d.persistGroupMetadata(ctx, group, true)
	}

	// Empty participant list from GetJoinedGroups (e.g. some community parents).
	if hasLocal && localCount > 0 {
		log.Printf(
			"backfill groups: skip GetGroupInfo for %s (local roster already has %d members)",
			groupJID,
			localCount,
		)
		return groupSyncResult{skippedRoster: true}, d.persistGroupMetadata(ctx, group, false)
	}

	log.Printf("backfill groups: local roster missing for %s — throttled GetGroupInfo", groupJID)
	info, err := d.getGroupInfoThrottled(ctx, group.JID)
	if err != nil {
		if errors.Is(err, errGroupIQCoolingDown) {
			_ = d.persistGroupMetadata(ctx, group, false)
			return groupSyncResult{}, err
		}
		log.Printf("GetGroupInfo for %s failed, storing partial metadata: %v", group.JID, err)
		return groupSyncResult{}, d.persistGroupMetadata(ctx, group, false)
	}
	return groupSyncResult{}, d.persistGroupMetadata(ctx, info, true)
}

// localGroupRosterState returns local membership count and last update time.
// Example: `count, updatedAt, ok := d.localGroupRosterState(ctx, groupJID)`
func (d *daemon) localGroupRosterState(ctx context.Context, groupJID string) (int, int64, bool) {
	if d == nil || d.db == nil || groupJID == "" {
		return 0, 0, false
	}

	var updatedAt sql.NullInt64
	err := d.db.QueryRowContext(
		ctx,
		`SELECT updated_at FROM groups WHERE group_jid = ?`,
		groupJID,
	).Scan(&updatedAt)
	if err != nil {
		return 0, 0, false
	}

	var count int
	if err := d.db.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM group_contacts WHERE group_jid = ?`,
		groupJID,
	).Scan(&count); err != nil {
		return 0, updatedAt.Int64, false
	}

	return count, updatedAt.Int64, true
}

// rosterLooksFresh reports whether the local roster can be left alone.
// Example: `if d.rosterLooksFresh(localCount, updatedAt, listCount) { skip }`
func (d *daemon) rosterLooksFresh(localCount int, updatedAt int64, listCount int) bool {
	if localCount <= 0 || updatedAt <= 0 {
		return false
	}
	if time.Since(time.Unix(updatedAt, 0)) > groupRosterFreshFor {
		return false
	}
	// Allow small drift; live join/leave events keep the table accurate between full rewrites.
	if listCount > 0 {
		delta := localCount - listCount
		if delta < 0 {
			delta = -delta
		}
		if delta > 5 && delta*100 > listCount*5 {
			return false
		}
	}
	return true
}

// awaitGroupIQ spaces out WhatsApp group info queries and honors cooldown after 429s.
// Example: `if err := d.awaitGroupIQ(ctx); err != nil { return err }`
func (d *daemon) awaitGroupIQ(ctx context.Context) error {
	if d == nil {
		return nil
	}

	for {
		d.groupIQMu.Lock()
		now := time.Now()
		if !d.groupIQCooldownUntil.IsZero() && now.Before(d.groupIQCooldownUntil) {
			until := d.groupIQCooldownUntil
			d.groupIQMu.Unlock()
			return fmt.Errorf("%w (until %s)", errGroupIQCoolingDown, until.UTC().Format(time.RFC3339))
		}

		wait := groupIQMinInterval - now.Sub(d.groupIQLastRequest)
		if d.groupIQLastRequest.IsZero() || wait <= 0 {
			d.groupIQLastRequest = now
			d.groupIQMu.Unlock()
			return nil
		}
		d.groupIQMu.Unlock()

		log.Printf("group IQ throttle: waiting %s before next WhatsApp group request", wait.Round(time.Millisecond))
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}

// markGroupIQRateLimited starts a cooldown after WhatsApp returns rate-overlimit.
// Example: `d.markGroupIQRateLimited()`
func (d *daemon) markGroupIQRateLimited() {
	if d == nil {
		return
	}

	d.groupIQMu.Lock()
	defer d.groupIQMu.Unlock()

	d.groupIQCooldownUntil = time.Now().Add(groupIQRateLimitCooldown)
	log.Printf(
		"group IQ rate-overlimit: pausing further group fetches until %s",
		d.groupIQCooldownUntil.UTC().Format(time.RFC3339),
	)
}

// isGroupIQRateOverLimit reports whether err is a WhatsApp 429 rate-overlimit response.
// Example: `if isGroupIQRateOverLimit(err) { d.markGroupIQRateLimited() }`
func isGroupIQRateOverLimit(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, whatsmeow.ErrIQRateOverLimit) {
		return true
	}
	return strings.Contains(err.Error(), "rate-overlimit")
}

// getGroupInfoThrottled fetches group info with spacing and 429 cooldown handling.
// Example: `info, err := d.getGroupInfoThrottled(ctx, jid)`
func (d *daemon) getGroupInfoThrottled(ctx context.Context, jid types.JID) (*types.GroupInfo, error) {
	if err := d.awaitGroupIQ(ctx); err != nil {
		return nil, err
	}

	log.Printf("group IQ: GetGroupInfo %s", jid)
	started := time.Now()
	info, err := d.client.GetGroupInfo(ctx, jid)
	if isGroupIQRateOverLimit(err) {
		d.markGroupIQRateLimited()
		return nil, fmt.Errorf("%w: %v", errGroupIQCoolingDown, err)
	}
	if err != nil {
		log.Printf("group IQ: GetGroupInfo %s failed after %s: %v", jid, time.Since(started).Round(time.Millisecond), err)
		return nil, err
	}
	log.Printf(
		"group IQ: GetGroupInfo %s ok in %s (name=%q participants=%d)",
		jid,
		time.Since(started).Round(time.Millisecond),
		info.Name,
		len(info.Participants),
	)
	return info, nil
}

// syncGroupWithFullInfo refreshes a group via GetGroupInfo only when roster data is missing locally
// and the provided payload has no participants.
// Example: `if err := d.syncGroupWithFullInfo(ctx, group); err != nil { return err }`
func (d *daemon) syncGroupWithFullInfo(ctx context.Context, group *types.GroupInfo) error {
	_, err := d.syncGroupFromJoinedList(ctx, group)
	return err
}

// storeJoinedGroup upserts group metadata and membership for newly joined groups.
// Example: `if err := d.storeJoinedGroup(ctx, evt); err != nil { return err }`
func (d *daemon) storeJoinedGroup(ctx context.Context, evt *events.JoinedGroup) error {
	if evt == nil {
		return nil
	}

	// No community subgroup fan-out — only store the group we actually joined.
	_, err := d.syncGroupFromJoinedList(ctx, &evt.GroupInfo)
	return err
}

// storeGroupInfoChange persists live group metadata and membership changes.
// Example: `if err := d.storeGroupInfoChange(ctx, evt); err != nil { return err }`
func (d *daemon) storeGroupInfoChange(ctx context.Context, evt *events.GroupInfo) error {
	if evt == nil || evt.JID.IsEmpty() {
		return nil
	}

	updatedAt := unixOrNow(evt.Timestamp)

	if evt.Delete != nil && evt.Delete.Deleted {
		return d.deleteGroup(ctx, evt.JID.String())
	}

	if evt.Name != nil {
		if err := d.upsertSyncChatMetadata(ctx, syncChatMetadata{
			chatJID:     evt.JID.String(),
			displayName: evt.Name.Name,
			updatedAt:   updatedAt,
		}); err != nil {
			return err
		}
	}

	if err := d.patchGroupFromInfoChange(ctx, evt, updatedAt); err != nil {
		return err
	}

	if err := d.applyGroupMembershipChanges(ctx, evt, updatedAt); err != nil {
		return err
	}

	return nil
}

// deleteGroup removes group metadata and the mirrored sync_chats row.
// Example: `if err := d.deleteGroup(ctx, groupJID); err != nil { return err }`
func (d *daemon) deleteGroup(ctx context.Context, groupJID string) error {
	if d == nil || d.db == nil || groupJID == "" {
		return nil
	}

	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin delete group %s: %w", groupJID, err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM groups WHERE group_jid = ?`, groupJID); err != nil {
		return fmt.Errorf("delete group %s: %w", groupJID, err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM sync_chats WHERE chat_jid = ?`, groupJID); err != nil {
		return fmt.Errorf("delete sync chat for group %s: %w", groupJID, err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit delete group %s: %w", groupJID, err)
	}

	d.notifyDatabaseChanged()
	return nil
}

// storeGroupMetadata writes group metadata into sync_chats and the groups/contacts tables.
// Example: `if err := d.storeGroupMetadata(ctx, group); err != nil { return err }`
func (d *daemon) storeGroupMetadata(ctx context.Context, group *types.GroupInfo) error {
	return d.persistGroupMetadata(ctx, group, true)
}

// persistGroupMetadata upserts group metadata and optionally rewrites membership.
// Example: `if err := d.persistGroupMetadata(ctx, group, false); err != nil { return err }`
func (d *daemon) persistGroupMetadata(ctx context.Context, group *types.GroupInfo, replaceRoster bool) error {
	if group == nil || group.JID.IsEmpty() {
		return nil
	}

	started := time.Now()
	log.Printf(
		"store group metadata: %s (%s, participants=%d, replace_roster=%t)",
		group.JID,
		group.Name,
		len(group.Participants),
		replaceRoster,
	)

	if err := d.upsertSyncChatMetadata(ctx, syncChatMetadata{
		chatJID:     group.JID.String(),
		displayName: group.Name,
		updatedAt:   unixOrNow(group.NameSetAt),
	}); err != nil {
		return err
	}

	if err := d.upsertGroup(ctx, group); err != nil {
		return err
	}

	if replaceRoster {
		if err := d.replaceGroupContacts(ctx, group); err != nil {
			return err
		}
	}

	log.Printf(
		"store group metadata: %s done in %s",
		group.JID,
		time.Since(started).Round(time.Millisecond),
	)
	return nil
}

// upsertGroup writes the latest known metadata for a joined group/community.
// Example: `if err := d.upsertGroup(ctx, group); err != nil { return err }`
func (d *daemon) upsertGroup(ctx context.Context, group *types.GroupInfo) error {
	if d == nil || d.db == nil || group == nil || group.JID.IsEmpty() {
		return nil
	}

	updatedAt := time.Now().Unix()
	participantCount := group.ParticipantCount
	if participantCount == 0 {
		participantCount = len(group.Participants)
	}

	_, err := d.db.ExecContext(
		ctx,
		`INSERT INTO groups (
			group_jid,
			name,
			topic,
			owner_jid,
			owner_phone,
			created_at,
			creator_country_code,
			is_locked,
			is_announce,
			is_ephemeral,
			disappearing_timer,
			is_incognito,
			is_parent,
			linked_parent_jid,
			is_default_sub,
			membership_approval_required,
			member_add_mode,
			addressing_mode,
			participant_count,
			participant_version_id,
			suspended,
			updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(group_jid) DO UPDATE SET
			name = COALESCE(excluded.name, groups.name),
			topic = COALESCE(excluded.topic, groups.topic),
			owner_jid = COALESCE(excluded.owner_jid, groups.owner_jid),
			owner_phone = COALESCE(excluded.owner_phone, groups.owner_phone),
			created_at = COALESCE(excluded.created_at, groups.created_at),
			creator_country_code = COALESCE(excluded.creator_country_code, groups.creator_country_code),
			is_locked = excluded.is_locked,
			is_announce = excluded.is_announce,
			is_ephemeral = excluded.is_ephemeral,
			disappearing_timer = COALESCE(excluded.disappearing_timer, groups.disappearing_timer),
			is_incognito = excluded.is_incognito,
			is_parent = excluded.is_parent,
			linked_parent_jid = COALESCE(excluded.linked_parent_jid, groups.linked_parent_jid),
			is_default_sub = excluded.is_default_sub,
			membership_approval_required = excluded.membership_approval_required,
			member_add_mode = COALESCE(excluded.member_add_mode, groups.member_add_mode),
			addressing_mode = COALESCE(excluded.addressing_mode, groups.addressing_mode),
			participant_count = COALESCE(excluded.participant_count, groups.participant_count),
			participant_version_id = COALESCE(excluded.participant_version_id, groups.participant_version_id),
			suspended = excluded.suspended,
			updated_at = excluded.updated_at`,
		group.JID.String(),
		nilIfEmpty(group.Name),
		nilIfEmpty(group.Topic),
		nilIfEmpty(jidString(group.OwnerJID)),
		nilIfEmpty(normalizePhoneNumberJID(firstNonEmptyJID(group.OwnerPN, group.OwnerJID))),
		nilIfZero(unixOrZero(group.GroupCreated)),
		nilIfEmpty(group.CreatorCountryCode),
		boolToInt(group.IsLocked),
		boolToInt(group.IsAnnounce),
		boolToInt(group.IsEphemeral),
		nilIfZero(int64(group.DisappearingTimer)),
		boolToInt(group.IsIncognito),
		boolToInt(group.IsParent),
		nilIfEmpty(jidString(group.LinkedParentJID)),
		boolToInt(group.IsDefaultSubGroup),
		boolToInt(group.IsJoinApprovalRequired),
		nilIfEmpty(string(group.MemberAddMode)),
		nilIfEmpty(string(group.AddressingMode)),
		nilIfZero(int64(participantCount)),
		nilIfEmpty(group.ParticipantVersionID),
		boolToInt(group.Suspended),
		updatedAt,
	)
	if err != nil {
		return fmt.Errorf("upsert group %s: %w", group.JID, err)
	}

	d.notifyDatabaseChanged()
	return nil
}

// patchGroupFromInfoChange applies sparse live group metadata updates.
// Example: `if err := d.patchGroupFromInfoChange(ctx, evt, updatedAt); err != nil { return err }`
func (d *daemon) patchGroupFromInfoChange(ctx context.Context, evt *events.GroupInfo, updatedAt int64) error {
	if d == nil || d.db == nil || evt == nil || evt.JID.IsEmpty() {
		return nil
	}

	if evt.Name == nil && evt.Topic == nil && evt.Locked == nil && evt.Announce == nil &&
		evt.Ephemeral == nil && evt.MembershipApprovalMode == nil &&
		!evt.Suspended && !evt.Unsuspended && evt.ParticipantVersionID == "" {
		return nil
	}

	_, err := d.db.ExecContext(
		ctx,
		`INSERT INTO groups (group_jid, updated_at) VALUES (?, ?)
		ON CONFLICT(group_jid) DO UPDATE SET updated_at = excluded.updated_at`,
		evt.JID.String(),
		updatedAt,
	)
	if err != nil {
		return fmt.Errorf("ensure group row %s: %w", evt.JID, err)
	}

	if evt.Name != nil {
		if _, err := d.db.ExecContext(
			ctx,
			`UPDATE groups SET name = ?, updated_at = ? WHERE group_jid = ?`,
			nilIfEmpty(evt.Name.Name),
			updatedAt,
			evt.JID.String(),
		); err != nil {
			return fmt.Errorf("update group name %s: %w", evt.JID, err)
		}
	}

	if evt.Topic != nil {
		if _, err := d.db.ExecContext(
			ctx,
			`UPDATE groups SET topic = ?, updated_at = ? WHERE group_jid = ?`,
			nilIfEmpty(evt.Topic.Topic),
			updatedAt,
			evt.JID.String(),
		); err != nil {
			return fmt.Errorf("update group topic %s: %w", evt.JID, err)
		}
	}

	if evt.Locked != nil {
		if _, err := d.db.ExecContext(
			ctx,
			`UPDATE groups SET is_locked = ?, updated_at = ? WHERE group_jid = ?`,
			boolToInt(evt.Locked.IsLocked),
			updatedAt,
			evt.JID.String(),
		); err != nil {
			return fmt.Errorf("update group locked %s: %w", evt.JID, err)
		}
	}

	if evt.Announce != nil {
		if _, err := d.db.ExecContext(
			ctx,
			`UPDATE groups SET is_announce = ?, updated_at = ? WHERE group_jid = ?`,
			boolToInt(evt.Announce.IsAnnounce),
			updatedAt,
			evt.JID.String(),
		); err != nil {
			return fmt.Errorf("update group announce %s: %w", evt.JID, err)
		}
	}

	if evt.Ephemeral != nil {
		if _, err := d.db.ExecContext(
			ctx,
			`UPDATE groups SET is_ephemeral = ?, disappearing_timer = ?, updated_at = ? WHERE group_jid = ?`,
			boolToInt(evt.Ephemeral.IsEphemeral),
			nilIfZero(int64(evt.Ephemeral.DisappearingTimer)),
			updatedAt,
			evt.JID.String(),
		); err != nil {
			return fmt.Errorf("update group ephemeral %s: %w", evt.JID, err)
		}
	}

	if evt.MembershipApprovalMode != nil {
		if _, err := d.db.ExecContext(
			ctx,
			`UPDATE groups SET membership_approval_required = ?, updated_at = ? WHERE group_jid = ?`,
			boolToInt(evt.MembershipApprovalMode.IsJoinApprovalRequired),
			updatedAt,
			evt.JID.String(),
		); err != nil {
			return fmt.Errorf("update group membership approval %s: %w", evt.JID, err)
		}
	}

	if evt.ParticipantVersionID != "" {
		if _, err := d.db.ExecContext(
			ctx,
			`UPDATE groups SET participant_version_id = ?, updated_at = ? WHERE group_jid = ?`,
			evt.ParticipantVersionID,
			updatedAt,
			evt.JID.String(),
		); err != nil {
			return fmt.Errorf("update group participant version %s: %w", evt.JID, err)
		}
	}

	if evt.Suspended {
		if _, err := d.db.ExecContext(
			ctx,
			`UPDATE groups SET suspended = 1, updated_at = ? WHERE group_jid = ?`,
			updatedAt,
			evt.JID.String(),
		); err != nil {
			return fmt.Errorf("update group suspended %s: %w", evt.JID, err)
		}
	}

	if evt.Unsuspended {
		if _, err := d.db.ExecContext(
			ctx,
			`UPDATE groups SET suspended = 0, updated_at = ? WHERE group_jid = ?`,
			updatedAt,
			evt.JID.String(),
		); err != nil {
			return fmt.Errorf("update group unsuspended %s: %w", evt.JID, err)
		}
	}

	d.notifyDatabaseChanged()
	return nil
}

// replaceGroupContacts replaces the full membership roster for a group.
// Example: `if err := d.replaceGroupContacts(ctx, group); err != nil { return err }`
func (d *daemon) replaceGroupContacts(ctx context.Context, group *types.GroupInfo) error {
	if d == nil || d.db == nil || group == nil || group.JID.IsEmpty() {
		return nil
	}

	updatedAt := time.Now().Unix()
	groupJID := group.JID.String()

	// Resolve identities/names before opening a write transaction. LID/contact store
	// lookups use the same SQLite DB; holding a TX across them deadlocks the daemon.
	type memberRow struct {
		identity contactIdentity
		names    contactNames
		isAdmin  bool
		isSuper  bool
	}
	log.Printf("replace group contacts: resolving %d members for %s", len(group.Participants), groupJID)
	resolveStarted := time.Now()
	members := make([]memberRow, 0, len(group.Participants))
	for _, participant := range group.Participants {
		identity := d.resolveParticipantIdentity(ctx, participant)
		if identity.contactJID == "" {
			continue
		}
		members = append(members, memberRow{
			identity: identity,
			names:    d.lookupContactNames(ctx, identity),
			isAdmin:  participant.IsAdmin,
			isSuper:  participant.IsSuperAdmin,
		})
	}
	log.Printf(
		"replace group contacts: resolved %d/%d members for %s in %s",
		len(members),
		len(group.Participants),
		groupJID,
		time.Since(resolveStarted).Round(time.Millisecond),
	)

	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin group contacts transaction: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM group_contacts WHERE group_jid = ?`, groupJID); err != nil {
		return fmt.Errorf("clear group contacts for %s: %w", groupJID, err)
	}

	for _, member := range members {
		if err := upsertContactTx(ctx, tx, contactRecord{
			contactJID:   member.identity.contactJID,
			phoneNumber:  member.identity.phoneNumber,
			lidJID:       member.identity.lidJID,
			firstName:    member.names.firstName,
			fullName:     member.names.fullName,
			pushName:     member.names.pushName,
			businessName: member.names.businessName,
			updatedAt:    updatedAt,
		}); err != nil {
			return fmt.Errorf("upsert contact %s for group %s: %w", member.identity.contactJID, groupJID, err)
		}

		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO group_contacts (
				group_jid,
				contact_jid,
				phone_number,
				lid_jid,
				is_admin,
				is_super_admin,
				updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(group_jid, contact_jid) DO UPDATE SET
				phone_number = COALESCE(excluded.phone_number, group_contacts.phone_number),
				lid_jid = COALESCE(excluded.lid_jid, group_contacts.lid_jid),
				is_admin = excluded.is_admin,
				is_super_admin = excluded.is_super_admin,
				updated_at = excluded.updated_at`,
			groupJID,
			member.identity.contactJID,
			nilIfEmpty(member.identity.phoneNumber),
			nilIfEmpty(member.identity.lidJID),
			boolToInt(member.isAdmin),
			boolToInt(member.isSuper),
			updatedAt,
		); err != nil {
			return fmt.Errorf("upsert group contact %s in %s: %w", member.identity.contactJID, groupJID, err)
		}
	}

	if _, err := tx.ExecContext(
		ctx,
		`UPDATE groups
		SET participant_count = (
			SELECT COUNT(*) FROM group_contacts WHERE group_jid = ?
		),
		updated_at = ?
		WHERE group_jid = ?`,
		groupJID,
		updatedAt,
		groupJID,
	); err != nil {
		return fmt.Errorf("update participant count for %s: %w", groupJID, err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit group contacts for %s: %w", groupJID, err)
	}

	d.notifyDatabaseChanged()
	return nil
}

// applyGroupMembershipChanges applies Join/Leave/Promote/Demote updates from live events.
// Example: `if err := d.applyGroupMembershipChanges(ctx, evt, updatedAt); err != nil { return err }`
func (d *daemon) applyGroupMembershipChanges(ctx context.Context, evt *events.GroupInfo, updatedAt int64) error {
	if d == nil || d.db == nil || evt == nil || evt.JID.IsEmpty() {
		return nil
	}

	if len(evt.Join) == 0 && len(evt.Leave) == 0 && len(evt.Promote) == 0 && len(evt.Demote) == 0 {
		return nil
	}

	groupJID := evt.JID.String()

	_, err := d.db.ExecContext(
		ctx,
		`INSERT INTO groups (group_jid, updated_at) VALUES (?, ?)
		ON CONFLICT(group_jid) DO UPDATE SET updated_at = excluded.updated_at`,
		groupJID,
		updatedAt,
	)
	if err != nil {
		return fmt.Errorf("ensure group row for membership change %s: %w", groupJID, err)
	}

	for _, member := range evt.Join {
		identity := d.resolveJIDIdentity(ctx, member)
		if identity.contactJID == "" {
			continue
		}

		names := d.lookupContactNames(ctx, identity)
		if err := d.upsertContact(ctx, contactRecord{
			contactJID:   identity.contactJID,
			phoneNumber:  identity.phoneNumber,
			lidJID:       identity.lidJID,
			firstName:    names.firstName,
			fullName:     names.fullName,
			pushName:     names.pushName,
			businessName: names.businessName,
			updatedAt:    updatedAt,
		}); err != nil {
			log.Printf("upsert joined contact %s failed: %v", identity.contactJID, err)
			continue
		}

		// Drop any prior rows for this person (phone/LID/contact key variants) before insert
		// so rejoins reset admin flags and do not leave duplicate memberships.
		if err := d.deleteGroupContactMatches(ctx, d.db, groupJID, identity); err != nil {
			log.Printf("clear prior group contact %s in %s failed: %v", identity.contactJID, groupJID, err)
			continue
		}

		if _, err := d.db.ExecContext(
			ctx,
			`INSERT INTO group_contacts (
				group_jid,
				contact_jid,
				phone_number,
				lid_jid,
				is_admin,
				is_super_admin,
				updated_at
			) VALUES (?, ?, ?, ?, 0, 0, ?)
			ON CONFLICT(group_jid, contact_jid) DO UPDATE SET
				phone_number = COALESCE(excluded.phone_number, group_contacts.phone_number),
				lid_jid = COALESCE(excluded.lid_jid, group_contacts.lid_jid),
				is_admin = excluded.is_admin,
				is_super_admin = excluded.is_super_admin,
				updated_at = excluded.updated_at`,
			groupJID,
			identity.contactJID,
			nilIfEmpty(identity.phoneNumber),
			nilIfEmpty(identity.lidJID),
			updatedAt,
		); err != nil {
			log.Printf("add group contact %s to %s failed: %v", identity.contactJID, groupJID, err)
		}
	}

	for _, member := range evt.Leave {
		identity := d.resolveJIDIdentity(ctx, member)
		if identity.contactJID == "" {
			continue
		}

		if err := d.deleteGroupContactMatches(ctx, d.db, groupJID, identity); err != nil {
			log.Printf("remove group contact %s from %s failed: %v", identity.contactJID, groupJID, err)
		}
	}

	for _, member := range evt.Promote {
		if err := d.setGroupContactAdmin(ctx, groupJID, member, true, updatedAt); err != nil {
			log.Printf("promote group contact in %s failed: %v", groupJID, err)
		}
	}

	for _, member := range evt.Demote {
		if err := d.setGroupContactAdmin(ctx, groupJID, member, false, updatedAt); err != nil {
			log.Printf("demote group contact in %s failed: %v", groupJID, err)
		}
	}

	if _, err := d.db.ExecContext(
		ctx,
		`UPDATE groups
		SET participant_count = (
			SELECT COUNT(*) FROM group_contacts WHERE group_jid = ?
		),
		updated_at = ?
		WHERE group_jid = ?`,
		groupJID,
		updatedAt,
		groupJID,
	); err != nil {
		return fmt.Errorf("refresh participant count for %s: %w", groupJID, err)
	}

	d.notifyDatabaseChanged()
	return nil
}

// setGroupContactAdmin updates admin flags for a group member.
// Example: `if err := d.setGroupContactAdmin(ctx, groupJID, member, true, now); err != nil { return err }`
func (d *daemon) setGroupContactAdmin(ctx context.Context, groupJID string, member types.JID, isAdmin bool, updatedAt int64) error {
	identity := d.resolveJIDIdentity(ctx, member)
	if identity.contactJID == "" {
		return nil
	}

	_, err := d.db.ExecContext(
		ctx,
		`UPDATE group_contacts
		SET is_admin = ?, is_super_admin = CASE WHEN ? = 0 THEN 0 ELSE is_super_admin END, updated_at = ?
		WHERE group_jid = ?
			AND (
				contact_jid = ?
				OR (? != '' AND phone_number = ?)
				OR (? != '' AND lid_jid = ?)
			)`,
		boolToInt(isAdmin),
		boolToInt(isAdmin),
		updatedAt,
		groupJID,
		identity.contactJID,
		identity.phoneNumber,
		identity.phoneNumber,
		identity.lidJID,
		identity.lidJID,
	)
	return err
}

// deleteGroupContactMatches removes membership rows that match any known identity key.
// Example: `if err := d.deleteGroupContactMatches(ctx, db, groupJID, identity); err != nil { return err }`
func (d *daemon) deleteGroupContactMatches(ctx context.Context, execer contactExecer, groupJID string, identity contactIdentity) error {
	if execer == nil || groupJID == "" || identity.contactJID == "" {
		return nil
	}

	_, err := execer.ExecContext(
		ctx,
		`DELETE FROM group_contacts
		WHERE group_jid = ?
			AND (
				contact_jid = ?
				OR (? != '' AND phone_number = ?)
				OR (? != '' AND lid_jid = ?)
			)`,
		groupJID,
		identity.contactJID,
		identity.phoneNumber,
		identity.phoneNumber,
		identity.lidJID,
		identity.lidJID,
	)
	if err != nil {
		return fmt.Errorf("delete group contact matches for %s in %s: %w", identity.contactJID, groupJID, err)
	}

	return nil
}

// resolveParticipantIdentity maps a group participant to contact_jid + real phone when available.
// Example: `identity := d.resolveParticipantIdentity(ctx, participant)`
func (d *daemon) resolveParticipantIdentity(ctx context.Context, participant types.GroupParticipant) contactIdentity {
	phoneJID := participant.PhoneNumber
	lidJID := participant.LID
	primary := participant.JID.ToNonAD()

	if phoneJID.IsEmpty() {
		switch primary.Server {
		case types.DefaultUserServer, types.HostedServer:
			phoneJID = primary
		}
	}
	if lidJID.IsEmpty() {
		switch primary.Server {
		case types.HiddenUserServer, types.HostedLIDServer:
			lidJID = primary
		}
	}

	if phoneJID.IsEmpty() && !lidJID.IsEmpty() {
		if pn := d.lookupPNForLID(ctx, lidJID); !pn.IsEmpty() {
			phoneJID = pn
		}
	}
	if lidJID.IsEmpty() && !phoneJID.IsEmpty() {
		if lid := d.lookupLIDForPN(ctx, phoneJID); !lid.IsEmpty() {
			lidJID = lid
		}
	}

	phoneNumber := normalizePhoneNumberJID(phoneJID)
	contactJID := ""
	if !phoneJID.IsEmpty() {
		contactJID = phoneJID.ToNonAD().String()
	} else if !lidJID.IsEmpty() {
		contactJID = lidJID.ToNonAD().String()
	} else if !primary.IsEmpty() {
		contactJID = primary.String()
	}

	return contactIdentity{
		contactJID:  contactJID,
		phoneNumber: phoneNumber,
		lidJID:      jidString(lidJID),
		phoneJID:    phoneJID.ToNonAD(),
		lid:         lidJID.ToNonAD(),
	}
}

// resolveJIDIdentity maps an arbitrary member JID to contact_jid + real phone when available.
// Example: `identity := d.resolveJIDIdentity(ctx, member)`
func (d *daemon) resolveJIDIdentity(ctx context.Context, jid types.JID) contactIdentity {
	if jid.IsEmpty() {
		return contactIdentity{}
	}

	return d.resolveParticipantIdentity(ctx, types.GroupParticipant{JID: jid.ToNonAD()})
}

// lookupPNForLID returns the phone-number JID for a LID when present in the local map.
// Example: `pn := d.lookupPNForLID(ctx, lid)`
func (d *daemon) lookupPNForLID(ctx context.Context, lid types.JID) types.JID {
	if d == nil || d.client == nil || d.client.Store == nil || d.client.Store.LIDs == nil || lid.IsEmpty() {
		return types.EmptyJID
	}

	pn, err := d.client.Store.LIDs.GetPNForLID(ctx, lid.ToNonAD())
	if err != nil {
		log.Printf("lookup PN for LID %s failed: %v", lid, err)
		return types.EmptyJID
	}

	return pn.ToNonAD()
}

// lookupLIDForPN returns the LID for a phone-number JID when present in the local map.
// Example: `lid := d.lookupLIDForPN(ctx, pn)`
func (d *daemon) lookupLIDForPN(ctx context.Context, pn types.JID) types.JID {
	if d == nil || d.client == nil || d.client.Store == nil || d.client.Store.LIDs == nil || pn.IsEmpty() {
		return types.EmptyJID
	}

	lid, err := d.client.Store.LIDs.GetLIDForPN(ctx, pn.ToNonAD())
	if err != nil {
		log.Printf("lookup LID for PN %s failed: %v", pn, err)
		return types.EmptyJID
	}

	return lid.ToNonAD()
}

// lookupContactNames loads address-book / push / business names for a contact identity.
// Example: `names := d.lookupContactNames(ctx, identity)`
func (d *daemon) lookupContactNames(ctx context.Context, identity contactIdentity) contactNames {
	if d == nil || d.client == nil || d.client.Store == nil || d.client.Store.Contacts == nil {
		return contactNames{}
	}

	candidates := make([]types.JID, 0, 3)
	if !identity.phoneJID.IsEmpty() {
		candidates = append(candidates, identity.phoneJID)
	}
	if !identity.lid.IsEmpty() {
		candidates = append(candidates, identity.lid)
	}
	if identity.contactJID != "" {
		if parsed, err := types.ParseJID(identity.contactJID); err == nil {
			candidates = append(candidates, parsed)
		}
	}

	var merged contactNames
	seen := map[string]bool{}
	for _, candidate := range candidates {
		candidate = candidate.ToNonAD()
		if candidate.IsEmpty() || seen[candidate.String()] {
			continue
		}
		seen[candidate.String()] = true

		contact, err := d.client.Store.Contacts.GetContact(ctx, candidate)
		if err != nil {
			log.Printf("lookup contact names for %s failed: %v", candidate, err)
			continue
		}
		if !contact.Found {
			continue
		}

		if merged.firstName == "" {
			merged.firstName = contact.FirstName
		}
		if merged.fullName == "" {
			merged.fullName = contact.FullName
		}
		if merged.pushName == "" {
			merged.pushName = contact.PushName
		}
		if merged.businessName == "" {
			merged.businessName = contact.BusinessName
		}
	}

	return merged
}

// upsertContact inserts or updates a row in the contacts table.
// Example: `if err := d.upsertContact(ctx, record); err != nil { return err }`
func (d *daemon) upsertContact(ctx context.Context, record contactRecord) error {
	if d == nil || d.db == nil {
		return nil
	}

	return upsertContactTx(ctx, d.db, record)
}

// upsertContactTx upserts a contact using a DB or transaction handle.
// Example: `if err := upsertContactTx(ctx, tx, record); err != nil { return err }`
func upsertContactTx(ctx context.Context, execer contactExecer, record contactRecord) error {
	if execer == nil || record.contactJID == "" {
		return nil
	}

	_, err := execer.ExecContext(
		ctx,
		`INSERT INTO contacts (
			contact_jid,
			phone_number,
			lid_jid,
			first_name,
			full_name,
			push_name,
			business_name,
			updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(contact_jid) DO UPDATE SET
			phone_number = COALESCE(excluded.phone_number, contacts.phone_number),
			lid_jid = COALESCE(excluded.lid_jid, contacts.lid_jid),
			first_name = COALESCE(excluded.first_name, contacts.first_name),
			full_name = COALESCE(excluded.full_name, contacts.full_name),
			push_name = COALESCE(excluded.push_name, contacts.push_name),
			business_name = COALESCE(excluded.business_name, contacts.business_name),
			updated_at = excluded.updated_at`,
		record.contactJID,
		nilIfEmpty(record.phoneNumber),
		nilIfEmpty(record.lidJID),
		nilIfEmpty(record.firstName),
		nilIfEmpty(record.fullName),
		nilIfEmpty(record.pushName),
		nilIfEmpty(record.businessName),
		record.updatedAt,
	)
	if err != nil {
		return fmt.Errorf("upsert contact %s: %w", record.contactJID, err)
	}

	return nil
}

// syncContactsFromStore mirrors whatsmeow_contacts into contacts with resolved phone numbers.
// Example: `if err := d.syncContactsFromStore(ctx); err != nil { return err }`
func (d *daemon) syncContactsFromStore(ctx context.Context) error {
	if d == nil || d.client == nil || d.client.Store == nil || d.client.Store.Contacts == nil {
		return nil
	}

	allContacts, err := d.client.Store.Contacts.GetAllContacts(ctx)
	if err != nil {
		return fmt.Errorf("get all contacts: %w", err)
	}

	updatedAt := time.Now().Unix()
	for jid, info := range allContacts {
		identity := d.resolveJIDIdentity(ctx, jid)
		if identity.contactJID == "" {
			continue
		}

		if err := d.upsertContact(ctx, contactRecord{
			contactJID:   identity.contactJID,
			phoneNumber:  identity.phoneNumber,
			lidJID:       identity.lidJID,
			firstName:    info.FirstName,
			fullName:     info.FullName,
			pushName:     info.PushName,
			businessName: info.BusinessName,
			updatedAt:    updatedAt,
		}); err != nil {
			log.Printf("sync contact %s failed: %v", identity.contactJID, err)
		}
	}

	d.notifyDatabaseChanged()
	return nil
}

// jidString returns the non-AD string form of a JID, or empty when unset.
// Example: `value := jidString(group.OwnerJID)`
func jidString(jid types.JID) string {
	if jid.IsEmpty() {
		return ""
	}

	return jid.ToNonAD().String()
}

// firstNonEmptyJID returns the first non-empty JID.
// Example: `owner := firstNonEmptyJID(group.OwnerPN, group.OwnerJID)`
func firstNonEmptyJID(values ...types.JID) types.JID {
	for _, value := range values {
		if !value.IsEmpty() {
			return value
		}
	}

	return types.EmptyJID
}

// backfillContactDisplayNamesAsync refreshes missing DM names without blocking the event loop.
// Example: `d.backfillContactDisplayNamesAsync()`
func (d *daemon) backfillContactDisplayNamesAsync() {
	if d == nil || d.client == nil {
		return
	}

	if !d.contactDisplayNameSyncRunning.CompareAndSwap(false, true) {
		return
	}

	go func() {
		defer d.contactDisplayNameSyncRunning.Store(false)

		ctx, cancel := context.WithTimeout(context.Background(), groupMetadataSyncTimeout)
		defer cancel()

		if err := d.syncContactsFromStore(ctx); err != nil {
			log.Printf("sync contacts from store failed: %v", err)
		}

		if err := d.backfillContactDisplayNames(ctx); err != nil {
			log.Printf("backfill contact display names failed: %v", err)
		}
	}()
}

// backfillContactDisplayNames fills empty DM display_name values from the WhatsApp contact store.
// Example: `if err := d.backfillContactDisplayNames(ctx); err != nil { return err }`
func (d *daemon) backfillContactDisplayNames(ctx context.Context) error {
	if d == nil || d.db == nil || d.client == nil {
		return nil
	}

	rows, err := d.db.QueryContext(ctx, `
		SELECT chat_jid
		FROM sync_chats
		WHERE TRIM(COALESCE(display_name, '')) = ''
	`)
	if err != nil {
		return fmt.Errorf("query chats missing display names: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var chatJIDValue string
		if err := rows.Scan(&chatJIDValue); err != nil {
			return fmt.Errorf("scan chat missing display name: %w", err)
		}

		chatJID, err := types.ParseJID(chatJIDValue)
		if err != nil {
			log.Printf("skip contact display name backfill for %q: %v", chatJIDValue, err)
			continue
		}

		if !isDirectChatJID(chatJID) {
			continue
		}

		displayName := d.resolveDirectChatDisplayName(ctx, chatJID)
		if displayName == "" {
			continue
		}

		if err := d.upsertSyncChatMetadata(ctx, syncChatMetadata{
			chatJID:     chatJID.ToNonAD().String(),
			displayName: displayName,
			updatedAt:   time.Now().Unix(),
		}); err != nil {
			log.Printf("store contact display name for %s failed: %v", chatJID, err)
		}
	}

	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate chats missing display names: %w", err)
	}

	return nil
}

// storeContactChange persists address-book name updates for direct chats and contacts.
// Example: `if err := d.storeContactChange(ctx, evt); err != nil { return err }`
func (d *daemon) storeContactChange(ctx context.Context, evt *events.Contact) error {
	if evt == nil || evt.Action == nil || evt.JID.IsEmpty() {
		return nil
	}

	identity := d.resolveJIDIdentity(ctx, evt.JID)
	if identity.contactJID != "" {
		if err := d.upsertContact(ctx, contactRecord{
			contactJID:  identity.contactJID,
			phoneNumber: identity.phoneNumber,
			lidJID:      identity.lidJID,
			firstName:   evt.Action.GetFirstName(),
			fullName:    evt.Action.GetFullName(),
			updatedAt:   unixOrNow(evt.Timestamp),
		}); err != nil {
			log.Printf("upsert contact from contact change failed: %v", err)
		} else {
			d.notifyDatabaseChanged()
		}
	}

	displayName := firstNonEmpty(
		evt.Action.GetFullName(),
		evt.Action.GetFirstName(),
		evt.Action.GetUsername(),
	)
	if displayName == "" {
		return nil
	}

	return d.upsertDirectChatDisplayNames(ctx, evt.JID, displayName, unixOrNow(evt.Timestamp), false)
}

// storePushNameChange fills empty DM display names when a contact's push name is learned.
// Example: `if err := d.storePushNameChange(ctx, evt); err != nil { return err }`
func (d *daemon) storePushNameChange(ctx context.Context, evt *events.PushName) error {
	if evt == nil || evt.JID.IsEmpty() {
		return nil
	}

	identity := d.resolveJIDIdentity(ctx, evt.JID)
	if identity.contactJID != "" {
		if err := d.upsertContact(ctx, contactRecord{
			contactJID:  identity.contactJID,
			phoneNumber: identity.phoneNumber,
			lidJID:      identity.lidJID,
			pushName:    evt.NewPushName,
			updatedAt:   time.Now().Unix(),
		}); err != nil {
			log.Printf("upsert contact from push name failed: %v", err)
		} else {
			d.notifyDatabaseChanged()
		}
	}

	return d.upsertDirectChatDisplayNames(ctx, evt.JID, evt.NewPushName, time.Now().Unix(), true)
}

// storeBusinessNameChange fills empty DM display names when a business name is learned.
// Example: `if err := d.storeBusinessNameChange(ctx, evt); err != nil { return err }`
func (d *daemon) storeBusinessNameChange(ctx context.Context, evt *events.BusinessName) error {
	if evt == nil || evt.JID.IsEmpty() {
		return nil
	}

	identity := d.resolveJIDIdentity(ctx, evt.JID)
	if identity.contactJID != "" {
		if err := d.upsertContact(ctx, contactRecord{
			contactJID:   identity.contactJID,
			phoneNumber:  identity.phoneNumber,
			lidJID:       identity.lidJID,
			businessName: evt.NewBusinessName,
			updatedAt:    time.Now().Unix(),
		}); err != nil {
			log.Printf("upsert contact from business name failed: %v", err)
		} else {
			d.notifyDatabaseChanged()
		}
	}

	return d.upsertDirectChatDisplayNames(ctx, evt.JID, evt.NewBusinessName, time.Now().Unix(), true)
}

// upsertDirectChatDisplayNames writes a DM display name onto existing sync_chats rows for the JID and its LID/PN twin.
// Example: `err := d.upsertDirectChatDisplayNames(ctx, jid, name, now, true)`
func (d *daemon) upsertDirectChatDisplayNames(ctx context.Context, jid types.JID, displayName string, updatedAt int64, onlyIfEmpty bool) error {
	if d == nil || d.db == nil {
		return nil
	}

	displayName = strings.TrimSpace(displayName)
	if displayName == "" || jid.IsEmpty() || !isDirectChatJID(jid) {
		return nil
	}

	if updatedAt == 0 {
		updatedAt = time.Now().Unix()
	}

	for _, candidate := range d.directChatJIDVariants(ctx, jid) {
		chatJID := candidate.ToNonAD().String()
		query := `
			UPDATE sync_chats
			SET
				display_name = ?,
				updated_at = ?
			WHERE chat_jid = ?`
		if onlyIfEmpty {
			query = `
				UPDATE sync_chats
				SET
					display_name = ?,
					updated_at = ?
				WHERE chat_jid = ?
					AND (display_name IS NULL OR TRIM(display_name) = '')`
		}

		result, err := d.db.ExecContext(ctx, query, displayName, updatedAt, chatJID)
		if err != nil {
			return fmt.Errorf("update direct chat display name for %s: %w", chatJID, err)
		}

		rowsAffected, err := result.RowsAffected()
		if err != nil {
			return fmt.Errorf("update direct chat display name rows for %s: %w", chatJID, err)
		}
		if rowsAffected == 0 {
			continue
		}

		d.notifyDatabaseChanged()
		d.syncChatToPostgres(chatJID)
	}

	return nil
}

// resolveDirectChatDisplayName looks up a DM name from the local WhatsApp contact cache.
// Example: `name := d.resolveDirectChatDisplayName(ctx, chatJID)`
func (d *daemon) resolveDirectChatDisplayName(ctx context.Context, jid types.JID) string {
	if d == nil || d.client == nil || d.client.Store == nil || d.client.Store.Contacts == nil {
		return ""
	}

	for _, candidate := range d.directChatJIDVariants(ctx, jid) {
		contact, err := d.client.Store.Contacts.GetContact(ctx, candidate.ToNonAD())
		if err != nil {
			log.Printf("lookup contact display name for %s failed: %v", candidate, err)
			continue
		}

		if name := contactInfoDisplayName(contact); name != "" {
			return name
		}
	}

	return ""
}

// directChatJIDVariants returns the chat JID plus its mapped LID/PN twin when available.
// Example: `for _, candidate := range d.directChatJIDVariants(ctx, jid) { ... }`
func (d *daemon) directChatJIDVariants(ctx context.Context, jid types.JID) []types.JID {
	jid = jid.ToNonAD()
	candidates := []types.JID{jid}
	if d == nil || d.client == nil || d.client.Store == nil || d.client.Store.LIDs == nil {
		return candidates
	}

	var alt types.JID
	var err error
	switch jid.Server {
	case types.HiddenUserServer, types.HostedLIDServer:
		alt, err = d.client.Store.LIDs.GetPNForLID(ctx, jid)
	case types.DefaultUserServer, types.HostedServer:
		alt, err = d.client.Store.LIDs.GetLIDForPN(ctx, jid)
	default:
		return candidates
	}
	if err != nil {
		log.Printf("lookup LID/PN twin for %s failed: %v", jid, err)
		return candidates
	}
	if alt.IsEmpty() {
		return candidates
	}

	return append(candidates, alt.ToNonAD())
}

// contactInfoDisplayName picks the best human-readable name from a cached contact.
// Example: `name := contactInfoDisplayName(contact)`
func contactInfoDisplayName(contact types.ContactInfo) string {
	return firstNonEmpty(
		contact.FullName,
		contact.BusinessName,
		contact.FirstName,
		contact.PushName,
	)
}

// isDirectChatJID reports whether the JID is a 1:1 chat (phone number or LID), not a group/list.
// Example: `if isDirectChatJID(chatJID) { ... }`
func isDirectChatJID(jid types.JID) bool {
	switch jid.Server {
	case types.DefaultUserServer, types.LegacyUserServer, types.HiddenUserServer, types.HostedServer, types.HostedLIDServer:
		return jid.User != ""
	default:
		return false
	}
}

// upsertSyncChatMetadata updates the known chat metadata without clearing existing values on sparse payloads.
// Example: `if err := d.upsertSyncChatMetadata(ctx, metadata); err != nil { return err }`
func (d *daemon) upsertSyncChatMetadata(ctx context.Context, metadata syncChatMetadata) error {
	if d == nil || d.db == nil {
		return nil
	}

	if metadata.chatJID == "" {
		return nil
	}

	if metadata.updatedAt == 0 {
		metadata.updatedAt = time.Now().Unix()
	}

	_, err := d.db.ExecContext(
		ctx,
		`INSERT INTO sync_chats (
			chat_jid,
			display_name,
			updated_at
		) VALUES (?, ?, ?)
		ON CONFLICT(chat_jid) DO UPDATE SET
			display_name = COALESCE(excluded.display_name, sync_chats.display_name),
			updated_at = excluded.updated_at`,
		metadata.chatJID,
		nilIfEmpty(metadata.displayName),
		metadata.updatedAt,
	)
	if err != nil {
		return fmt.Errorf("upsert sync chat metadata for %s: %w", metadata.chatJID, err)
	}

	d.notifyDatabaseChanged()
	d.syncChatToPostgres(metadata.chatJID)

	return nil
}

// storeMessage upserts a parsed WhatsApp message into SQLite.
// Example: `if err := d.storeMessage(ctx, evt, "realtime"); err != nil { return err }`
func (d *daemon) storeMessage(ctx context.Context, evt *events.Message, source string) error {
	if evt == nil {
		return nil
	}

	now := time.Now()
	if err := d.deleteExpiredMessages(ctx, now); err != nil {
		return err
	}

	if evt.Info.Timestamp.Before(messageRetentionCutoff(now)) {
		return nil
	}

	if revokedID := getRevokedMessageID(evt); revokedID != "" {
		return d.deleteRevokedMessage(ctx, evt.Info.Chat.String(), revokedID)
	}

	payload := getStoredMessagePayload(evt)
	if !shouldStoreMessage(payload.message) {
		return nil
	}

	messageID := payload.id
	message := payload.message
	messageType, textValue := describeMessage(message)
	mediaInfo, mediaUploadJob := d.prepareMediaUploadJob(evt, messageID, message)
	senderPhoneNumber := extractSenderPhoneNumber(evt.Info.Sender, evt.Info.SenderAlt)

	_, err := d.db.ExecContext(
		ctx,
		`INSERT INTO sync_messages (
			chat_jid,
			message_id,
			sender_jid,
			sender_phone_number,
			server_id,
			timestamp,
			is_from_me,
			is_group,
			push_name,
			message_type,
			category,
			media_type,
			media_mime_type,
			media_path,
			media_sha256,
			text_value,
			raw_message_json,
			source_web_message_json,
			source,
			is_edit,
			is_ephemeral,
			is_view_once,
			updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(chat_jid, message_id) DO UPDATE SET
			sender_jid = excluded.sender_jid,
			sender_phone_number = excluded.sender_phone_number,
			server_id = excluded.server_id,
			timestamp = CASE
				WHEN excluded.is_edit = 1 THEN sync_messages.timestamp
				ELSE excluded.timestamp
			END,
			is_from_me = excluded.is_from_me,
			is_group = excluded.is_group,
			push_name = excluded.push_name,
			message_type = excluded.message_type,
			category = excluded.category,
			media_type = excluded.media_type,
			media_mime_type = excluded.media_mime_type,
			media_path = COALESCE(excluded.media_path, sync_messages.media_path),
			media_sha256 = COALESCE(excluded.media_sha256, sync_messages.media_sha256),
			text_value = excluded.text_value,
			raw_message_json = excluded.raw_message_json,
			source_web_message_json = COALESCE(excluded.source_web_message_json, sync_messages.source_web_message_json),
			source = excluded.source,
			is_edit = excluded.is_edit,
			is_ephemeral = excluded.is_ephemeral,
			is_view_once = excluded.is_view_once,
			updated_at = excluded.updated_at
		WHERE excluded.is_edit = 1 OR sync_messages.is_edit = 0`,
		evt.Info.Chat.String(),
		messageID,
		evt.Info.Sender.String(),
		nilIfEmpty(senderPhoneNumber),
		nilIfZero(int64(evt.Info.ServerID)),
		evt.Info.Timestamp.Unix(),
		boolToInt(evt.Info.IsFromMe),
		boolToInt(evt.Info.IsGroup),
		nilIfEmpty(evt.Info.PushName),
		nilIfEmpty(messageType),
		nilIfEmpty(evt.Info.Category),
		nilIfEmpty(evt.Info.MediaType),
		nilIfEmpty(mediaInfo.mimeType),
		nilIfEmpty(mediaInfo.path),
		nilIfEmpty(mediaInfo.sha256),
		nilIfEmpty(textValue),
		marshalProtoJSON(evt.RawMessage),
		marshalProtoJSON(evt.SourceWebMsg),
		source,
		boolToInt(payload.isEdit),
		boolToInt(evt.IsEphemeral),
		boolToInt(evt.IsViewOnce || evt.IsViewOnceV2 || evt.IsViewOnceV2Extension),
		now.Unix(),
	)
	if err != nil {
		return fmt.Errorf("upsert message %s/%s: %w", evt.Info.Chat, messageID, err)
	}

	chatJID := evt.Info.Chat.String()
	if err := d.touchSyncChatLastMessage(ctx, chatJID, evt.Info.Timestamp.Unix()); err != nil {
		return err
	}

	if !evt.Info.IsGroup && !evt.Info.IsFromMe {
		if err := d.upsertDirectChatDisplayNames(ctx, evt.Info.Chat, evt.Info.PushName, evt.Info.Timestamp.Unix(), true); err != nil {
			log.Printf("fill direct chat display name from push name for %s failed: %v", chatJID, err)
		}
	}

	d.notifyDatabaseChanged()
	d.syncChatToPostgres(chatJID)
	if mediaUploadJob != nil {
		d.r2.enqueueMediaUpload(*mediaUploadJob)
	}

	return nil
}

// deleteExpiredMessages removes synced messages older than the retention window.
// Example: `if err := d.deleteExpiredMessages(ctx, time.Now()); err != nil { return err }`
func (d *daemon) deleteExpiredMessages(ctx context.Context, now time.Time) error {
	if d == nil || d.db == nil {
		return nil
	}

	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin expired message cleanup: %w", err)
	}

	cutoff := messageRetentionCutoff(now).Unix()
	mediaPaths, err := getExpiredMessageMediaPaths(ctx, tx, cutoff)
	if err != nil {
		tx.Rollback()
		return err
	}

	_, err = tx.ExecContext(
		ctx,
		`DELETE FROM sync_messages WHERE timestamp < ?`,
		cutoff,
	)
	if err != nil {
		tx.Rollback()
		return fmt.Errorf("delete expired messages: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit expired message cleanup: %w", err)
	}

	for mediaPath := range mediaPaths {
		d.r2.enqueueMediaDelete(mediaPath)
	}

	d.notifyDatabaseChanged()

	return nil
}

// getRevokedMessageID returns the target message ID when evt is a "delete for everyone" revocation,
// or an empty string for all other event types.
// Example: `if id := getRevokedMessageID(evt); id != "" { ... }`
func getRevokedMessageID(evt *events.Message) types.MessageID {
	if evt == nil {
		return ``
	}

	proto := evt.Message.GetProtocolMessage()
	if proto == nil {
		return ``
	}

	if proto.GetType() != waE2E.ProtocolMessage_REVOKE {
		return ``
	}

	return types.MessageID(proto.GetKey().GetID())
}

// deleteRevokedMessage removes a user-deleted message and its media file from the DB.
// Example: `if err := d.deleteRevokedMessage(ctx, chatJID, messageID); err != nil { return err }`
func (d *daemon) deleteRevokedMessage(ctx context.Context, chatJID string, messageID types.MessageID) error {
	var mediaPath string
	row := d.db.QueryRowContext(
		ctx,
		`SELECT COALESCE(media_path, '') FROM sync_messages WHERE chat_jid = ? AND message_id = ?`,
		chatJID, messageID,
	)
	if err := row.Scan(&mediaPath); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("query revoked message media path %s/%s: %w", chatJID, messageID, err)
	}

	_, err := d.db.ExecContext(
		ctx,
		`DELETE FROM sync_messages WHERE chat_jid = ? AND message_id = ?`,
		chatJID, messageID,
	)
	if err != nil {
		return fmt.Errorf("delete revoked message %s/%s: %w", chatJID, messageID, err)
	}

	if mediaPath != `` {
		d.r2.enqueueMediaDelete(mediaPath)
	}

	d.notifyDatabaseChanged()

	return nil
}

// getExpiredMessageMediaPaths returns file paths for expired messages that have media.
// Example: `mediaPaths, err := getExpiredMessageMediaPaths(ctx, tx, cutoff)`
func getExpiredMessageMediaPaths(ctx context.Context, tx *sql.Tx, cutoff int64) (map[string]struct{}, error) {
	rows, err := tx.QueryContext(
		ctx,
		`SELECT media_path
		FROM sync_messages
		WHERE timestamp < ?
			AND media_path IS NOT NULL
			AND media_path != ''`,
		cutoff,
	)
	if err != nil {
		return nil, fmt.Errorf("query expired message media paths: %w", err)
	}
	defer rows.Close()

	mediaPaths := map[string]struct{}{}
	for rows.Next() {
		var mediaPath string
		if err := rows.Scan(&mediaPath); err != nil {
			return nil, fmt.Errorf("scan expired message media path: %w", err)
		}

		mediaPaths[mediaPath] = struct{}{}
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate expired message media paths: %w", err)
	}

	return mediaPaths, nil
}

// messageRetentionCutoff returns the oldest timestamp that may remain stored.
// Example: `cutoff := messageRetentionCutoff(time.Now())`
func messageRetentionCutoff(now time.Time) time.Time {
	return now.Add(-messageRetentionWindow)
}

// prepareMediaUploadJob builds remote media metadata and the async upload job.
// Example: `mediaInfo, job := d.prepareMediaUploadJob(evt, messageID, message)`
func (d *daemon) prepareMediaUploadJob(evt *events.Message, messageID types.MessageID, message *waE2E.Message) (storedMediaInfo, *mediaUploadJob) {
	downloadable, mediaKind, mimeType, sha256 := getDownloadableMedia(message)
	if downloadable == nil {
		return storedMediaInfo{}, nil
	}

	mediaInfo := storedMediaInfo{
		mimeType: mimeType,
		sha256:   sha256,
	}

	if evt == nil {
		return mediaInfo, nil
	}

	if evt.Info.Timestamp.Before(messageRetentionCutoff(time.Now())) {
		return mediaInfo, nil
	}

	objectKey := d.r2.mediaObjectKey(evt.Info.Chat.String(), messageID, mediaExtension(mimeType, mediaKind))
	mediaInfo.path = r2ObjectURI(d.r2.bucket, objectKey)

	return mediaInfo, &mediaUploadJob{
		chatJID:      evt.Info.Chat.String(),
		client:       d.client,
		downloadable: downloadable,
		messageID:    messageID,
		mimeType:     mimeType,
		objectKey:    objectKey,
		objectURI:    mediaInfo.path,
	}
}

// describeMessage extracts a stable type label and the most useful text-like payload.
// Example: `messageType, textValue := describeMessage(evt.Message)`
func describeMessage(message *waE2E.Message) (string, string) {
	if message == nil {
		return "", ""
	}

	switch {
	case message.GetConversation() != "":
		return "conversation", message.GetConversation()
	case message.GetExtendedTextMessage().GetText() != "":
		return "extended_text", message.GetExtendedTextMessage().GetText()
	case message.GetImageMessage() != nil:
		return "image", message.GetImageMessage().GetCaption()
	case message.GetVideoMessage() != nil:
		return "video", message.GetVideoMessage().GetCaption()
	case message.GetDocumentMessage() != nil:
		return "document", message.GetDocumentMessage().GetCaption()
	case message.GetAudioMessage() != nil:
		return "audio", ""
	case message.GetStickerMessage() != nil:
		return "sticker", ""
	case message.GetContactMessage() != nil:
		return "contact", message.GetContactMessage().GetDisplayName()
	case message.GetContactsArrayMessage() != nil:
		return "contacts_array", ""
	case message.GetLocationMessage() != nil:
		return "location", message.GetLocationMessage().GetName()
	case message.GetLiveLocationMessage() != nil:
		return "live_location", message.GetLiveLocationMessage().GetCaption()
	case message.GetPollCreationMessage() != nil:
		return "poll_creation", message.GetPollCreationMessage().GetName()
	case message.GetEventMessage() != nil:
		return "event", describeEventMessage(message.GetEventMessage())
	case message.GetReactionMessage() != nil:
		return "reaction", message.GetReactionMessage().GetText()
	case message.GetProtocolMessage() != nil:
		return "protocol", message.GetProtocolMessage().GetType().String()
	default:
		return strings.TrimPrefix(fmt.Sprintf("%T", message), "*waE2E."), ""
	}
}

// shouldStoreMessage reports whether the normalized payload is a supported text or media message.
// Example: `if !shouldStoreMessage(payload.message) { return nil }`
func shouldStoreMessage(message *waE2E.Message) bool {
	if message == nil {
		return false
	}

	switch {
	case message.GetConversation() != "":
		return true
	case message.GetExtendedTextMessage() != nil:
		return true
	case message.GetImageMessage() != nil:
		return true
	case message.GetVideoMessage() != nil:
		return true
	case message.GetDocumentMessage() != nil:
		return true
	case message.GetAudioMessage() != nil:
		return true
	case message.GetStickerMessage() != nil:
		return true
	case message.GetEventMessage() != nil:
		return true
	default:
		return false
	}
}

// describeEventMessage extracts the most useful text summary from a WhatsApp event payload.
// Example: `textValue := describeEventMessage(message.GetEventMessage())`
func describeEventMessage(message *waE2E.EventMessage) string {
	if message == nil {
		return ""
	}

	lines := []string{}
	name := message.GetName()
	if name != "" {
		lines = append(lines, fmt.Sprintf("Title: %s", name))
	}

	description := message.GetDescription()
	if description != "" {
		lines = append(lines, fmt.Sprintf("Description: %s", description))
	}

	locationName := message.GetLocation().GetName()
	if locationName != "" {
		lines = append(lines, fmt.Sprintf("Location: %s", locationName))
	}

	startTime := formatUnixTimestamp(message.GetStartTime())
	if startTime != "" {
		lines = append(lines, fmt.Sprintf("Starts: %s", startTime))
	}

	endTime := formatUnixTimestamp(message.GetEndTime())
	if endTime != "" {
		lines = append(lines, fmt.Sprintf("Ends: %s", endTime))
	}

	joinLink := message.GetJoinLink()
	if joinLink != "" {
		lines = append(lines, fmt.Sprintf("Join link: %s", joinLink))
	}

	if message.GetIsCanceled() {
		lines = append(lines, "Status: canceled")
	}

	if message.GetIsScheduleCall() {
		lines = append(lines, "Type: scheduled call")
	}

	if !linesHasValues(lines) {
		return ""
	}

	return strings.Join(lines, "\n")
}

// formatUnixTimestamp formats a Unix timestamp into RFC3339 when set.
// Example: `formatted := formatUnixTimestamp(message.GetStartTime())`
func formatUnixTimestamp(value int64) string {
	if value <= 0 {
		return ""
	}

	return time.Unix(value, 0).UTC().Format(time.RFC3339)
}

// linesHasValues reports whether the assembled event summary has any rows.
// Example: `if !linesHasValues(lines) { return "" }`
func linesHasValues(lines []string) bool {
	return len(lines) > 0
}

// marshalProtoJSON converts protobuf payloads into JSON for downstream SQLite consumers.
// Example: `rawJSON := marshalProtoJSON(evt.RawMessage)`
func marshalProtoJSON(message proto.Message) any {
	if message == nil {
		return nil
	}

	data, err := protojson.MarshalOptions{
		UseProtoNames: true,
		AllowPartial:  true,
	}.Marshal(message)
	if err != nil {
		log.Printf("marshal protobuf JSON failed: %v", err)
		return nil
	}

	return string(data)
}

// firstNonEmpty returns the first non-empty string from left to right.
// Example: `name := firstNonEmpty(displayName, name, username)`
func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}

	return ""
}

// nilIfEmpty stores empty strings as NULL in SQLite.
// Example: `value := nilIfEmpty(evt.Info.PushName)`
func nilIfEmpty(value string) any {
	if value == "" {
		return nil
	}

	return value
}

// nilIfZero stores zero integers as NULL in SQLite.
// Example: `value := nilIfZero(int64(evt.Info.ServerID))`
func nilIfZero(value int64) any {
	if value == 0 {
		return nil
	}

	return value
}

// boolToInt converts booleans into SQLite-friendly integer values.
// Example: `isFromMe := boolToInt(evt.Info.IsFromMe)`
func boolToInt(value bool) int {
	if value {
		return 1
	}

	return 0
}

// unixOrNow returns a Unix timestamp and falls back to the current time for zero values.
// Example: `updatedAt := unixOrNow(evt.Timestamp)`
func unixOrNow(value time.Time) int64 {
	if value.IsZero() {
		return time.Now().Unix()
	}

	return value.Unix()
}

// unixOrZero returns a Unix timestamp, or 0 when the time is unset.
// Example: `createdAt := unixOrZero(group.GroupCreated)`
func unixOrZero(value time.Time) int64 {
	if value.IsZero() {
		return 0
	}

	return value.Unix()
}

// execIgnoringDuplicateColumn runs a schema change and skips duplicate-column errors.
// Example: `err := execIgnoringDuplicateColumn(ctx, db, statement)`
func execIgnoringDuplicateColumn(ctx context.Context, db *sql.DB, statement string) error {
	if _, err := db.ExecContext(ctx, statement); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "duplicate column name") {
			return nil
		}

		return fmt.Errorf("apply schema update failed: %w", err)
	}

	return nil
}

// extractSenderPhoneNumber returns the sender phone number in `+`-prefixed format when available.
// Example: `phone := extractSenderPhoneNumber(evt.Info.Sender, evt.Info.SenderAlt)`
func extractSenderPhoneNumber(sender, senderAlt types.JID) string {
	primaryPhoneNumber := normalizePhoneNumberJID(sender)
	if primaryPhoneNumber != "" {
		return primaryPhoneNumber
	}

	return normalizePhoneNumberJID(senderAlt)
}

// normalizePhoneNumberJID converts a phone-number JID into a `+`-prefixed phone number.
// Example: `phone := normalizePhoneNumberJID(evt.Info.SenderAlt)`
func normalizePhoneNumberJID(jid types.JID) string {
	if jid.User == "" {
		return ""
	}

	switch jid.Server {
	case types.DefaultUserServer, types.HostedServer:
	default:
		return ""
	}

	for _, char := range jid.User {
		if char < '0' || char > '9' {
			return ""
		}
	}

	return fmt.Sprintf("+%s", jid.User)
}

// getStoredMessagePayload resolves the normalized message ID and content that should be persisted.
// Example: `payload := getStoredMessagePayload(evt)`
func getStoredMessagePayload(evt *events.Message) storedMessagePayload {
	if evt == nil {
		return storedMessagePayload{}
	}

	payload := storedMessagePayload{
		id:      evt.Info.ID,
		message: evt.Message,
		isEdit:  evt.IsEdit,
	}

	protocolMessage := getEditProtocolMessage(evt)
	if protocolMessage == nil || protocolMessage.GetType() != waE2E.ProtocolMessage_MESSAGE_EDIT {
		return payload
	}

	payload.isEdit = true
	if protocolMessage.GetKey().GetID() != "" {
		payload.id = types.MessageID(protocolMessage.GetKey().GetID())
	}

	if protocolMessage.GetEditedMessage() != nil {
		payload.message = protocolMessage.GetEditedMessage()
	}

	return payload
}

// getEditProtocolMessage returns the embedded protocol edit message from all known edit event shapes.
// Example: `protocolMessage := getEditProtocolMessage(evt)`
func getEditProtocolMessage(evt *events.Message) *waE2E.ProtocolMessage {
	if evt == nil {
		return nil
	}

	if protocolMessage := evt.Message.GetProtocolMessage(); protocolMessage != nil {
		return protocolMessage
	}

	editedMessage := evt.RawMessage.GetEditedMessage().GetMessage()
	if editedMessage == nil {
		return nil
	}

	return editedMessage.GetProtocolMessage()
}

// getDownloadableMedia returns the first downloadable attachment in a message.
// Example: `media, kind, mimeType, sha := getDownloadableMedia(evt.Message)`
func getDownloadableMedia(message *waE2E.Message) (whatsmeow.DownloadableMessage, string, string, string) {
	if message == nil {
		return nil, "", "", ""
	}

	switch {
	case message.GetImageMessage() != nil:
		image := message.GetImageMessage()
		return image, "image", image.GetMimetype(), encodeHex(image.GetFileSHA256())
	case message.GetVideoMessage() != nil:
		video := message.GetVideoMessage()
		return video, "video", video.GetMimetype(), encodeHex(video.GetFileSHA256())
	case message.GetAudioMessage() != nil:
		audio := message.GetAudioMessage()
		return audio, "audio", audio.GetMimetype(), encodeHex(audio.GetFileSHA256())
	case message.GetDocumentMessage() != nil:
		document := message.GetDocumentMessage()
		return document, "document", document.GetMimetype(), encodeHex(document.GetFileSHA256())
	case message.GetStickerMessage() != nil:
		sticker := message.GetStickerMessage()
		return sticker, "sticker", sticker.GetMimetype(), encodeHex(sticker.GetFileSHA256())
	default:
		return nil, "", "", ""
	}
}

// mediaExtension derives a stable filename extension from a mime type.
// Example: `extension := mediaExtension("image/jpeg", "image")`
func mediaExtension(mimeType, mediaKind string) string {
	switch strings.ToLower(mimeType) {
	case "image/jpeg", "image/jpg", "image/pjpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	case "video/mp4":
		return ".mp4"
	case "audio/ogg":
		return ".ogg"
	case "audio/mpeg":
		return ".mp3"
	case "application/pdf":
		return ".pdf"
	}

	extensions, err := mime.ExtensionsByType(mimeType)
	if err == nil && len(extensions) > 0 {
		return extensions[0]
	}

	switch mediaKind {
	case "image":
		return ".bin"
	case "video":
		return ".bin"
	case "audio":
		return ".bin"
	case "document":
		return ".bin"
	case "sticker":
		return ".webp"
	default:
		return ".bin"
	}
}

// sanitizePathSegment removes path separators and unsafe filename characters.
// Example: `safe := sanitizePathSegment(evt.Info.Chat.String())`
func sanitizePathSegment(value string) string {
	var builder strings.Builder

	for _, char := range value {
		switch {
		case char >= 'a' && char <= 'z':
			builder.WriteRune(char)
		case char >= 'A' && char <= 'Z':
			builder.WriteRune(char)
		case char >= '0' && char <= '9':
			builder.WriteRune(char)
		case char == '.', char == '-', char == '_', char == '@':
			builder.WriteRune(char)
		default:
			builder.WriteRune('_')
		}
	}

	if builder.Len() == 0 {
		return "unknown"
	}

	return builder.String()
}

// encodeHex converts a byte slice to hex and keeps empty values as an empty string.
// Example: `sha := encodeHex(image.GetFileSHA256())`
func encodeHex(value []byte) string {
	if len(value) == 0 {
		return ""
	}

	return hex.EncodeToString(value)
}

// stripJSONCComments removes `//` and `/* */` comments while preserving strings.
// Example: `clean := stripJSONCComments(data)`
func stripJSONCComments(data []byte) []byte {
	var builder strings.Builder
	builder.Grow(len(data))

	inString := false
	inLineComment := false
	inBlockComment := false
	isEscaped := false

	for index := 0; index < len(data); index++ {
		char := data[index]

		switch {
		case inLineComment:
			if char == '\n' {
				inLineComment = false
				builder.WriteByte(char)
			}
		case inBlockComment:
			if char == '*' && index+1 < len(data) && data[index+1] == '/' {
				inBlockComment = false
				index++
			}
		case inString:
			builder.WriteByte(char)
			if isEscaped {
				isEscaped = false
				continue
			}

			if char == '\\' {
				isEscaped = true
				continue
			}

			if char == '"' {
				inString = false
			}
		default:
			if char == '"' {
				inString = true
				builder.WriteByte(char)
				continue
			}

			if char == '/' && index+1 < len(data) {
				switch data[index+1] {
				case '/':
					inLineComment = true
					index++
					continue
				case '*':
					inBlockComment = true
					index++
					continue
				}
			}

			builder.WriteByte(char)
		}
	}

	return []byte(builder.String())
}

// shutdown flushes background R2 work before the daemon exits.
// Example: `if err := d.shutdown(ctx); err != nil { return err }`
func (d *daemon) shutdown(ctx context.Context) error {
	if d == nil {
		return nil
	}

	d.stopEventPersistWorker()

	if d.postgres != nil {
		d.postgres.Close()
	}

	if d.r2 == nil {
		return nil
	}

	return d.r2.Shutdown(ctx)
}

// notifyDatabaseChanged schedules an async SQLite snapshot upload.
// Example: `d.notifyDatabaseChanged()`
func (d *daemon) notifyDatabaseChanged() {
	if d == nil || d.r2 == nil {
		return
	}

	d.r2.NotifyDatabaseChanged()
}

// validate ensures the daemon has the required R2 configuration.
// Example: `if err := config.validate(); err != nil { return err }`
func (c daemonConfig) validate() error {
	switch {
	case strings.TrimSpace(c.DatabasePath) == "":
		return errors.New("missing `database_path` in config")
	case strings.TrimSpace(c.PostgresDatabaseURL) == "":
		return errors.New("missing `postgres_database_url` in config")
	case strings.TrimSpace(c.R2Bucket) == "":
		return errors.New("missing `r2_bucket` in config")
	case strings.TrimSpace(c.R2AccessKeyID) == "":
		return errors.New("missing `r2_access_key_id` in config")
	case strings.TrimSpace(c.R2SecretAccessKey) == "":
		return errors.New("missing `r2_secret_access_key` in config")
	case strings.TrimSpace(c.R2DatabaseObjectKey) == "":
		return errors.New("missing `r2_database_object_key` in config")
	case c.r2Endpoint() == "":
		return errors.New("missing `r2_endpoint` or `r2_account_id` in config")
	case c.databaseSyncInterval() <= 0:
		return errors.New("`database_sync_interval` must be greater than zero")
	}

	return nil
}

// r2Endpoint resolves the configured Cloudflare R2 endpoint.
// Example: `endpoint := config.r2Endpoint()`
func (c daemonConfig) r2Endpoint() string {
	if strings.TrimSpace(c.R2Endpoint) != "" {
		return strings.TrimSpace(c.R2Endpoint)
	}

	accountID := strings.TrimSpace(c.R2AccountID)
	if accountID == "" {
		return ""
	}

	return fmt.Sprintf("https://%s.r2.cloudflarestorage.com", accountID)
}

// databaseSyncInterval parses the configured periodic SQLite sync interval.
// Example: `interval := config.databaseSyncInterval()`
func (c daemonConfig) databaseSyncInterval() time.Duration {
	interval, err := time.ParseDuration(strings.TrimSpace(c.DatabaseSyncInterval))
	if err != nil {
		return 0
	}

	return interval
}

// resolvePath makes relative config paths resolve from the config file directory.
// Example: `dbPath, err := config.resolvePath(config.DatabasePath)`
func (c daemonConfig) resolvePath(value string) (string, error) {
	if filepath.IsAbs(value) {
		return value, nil
	}

	basePath := c.configDirectory
	if basePath == "" {
		basePath = "."
	}

	return filepath.Abs(filepath.Join(basePath, value))
}

// newR2Manager creates the async R2 workers used for media and SQLite replication.
// Example: `manager, err := newR2Manager(ctx, config)`
func newR2Manager(ctx context.Context, config r2ManagerConfig) (*r2Manager, error) {
	snapshotDB, err := openDatabase(config.DatabasePath)
	if err != nil {
		return nil, fmt.Errorf("open snapshot database: %w", err)
	}

	awsCfg, err := awsConfig.LoadDefaultConfig(
		ctx,
		awsConfig.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(config.AccessKeyID, config.SecretAccessKey, ""),
		),
		awsConfig.WithRegion("auto"),
	)
	if err != nil {
		snapshotDB.Close()
		return nil, fmt.Errorf("load R2 AWS config: %w", err)
	}

	client := s3.NewFromConfig(awsCfg, func(options *s3.Options) {
		options.BaseEndpoint = aws.String(config.Endpoint)
		options.UsePathStyle = true
	})

	manager := &r2Manager{
		bucket:            config.Bucket,
		client:            client,
		databaseObjectKey: strings.Trim(config.DatabaseObjectKey, "/"),
		mediaPrefix:       strings.Trim(config.MediaPrefix, "/"),
		mediaUploads:      make(chan mediaUploadJob, mediaUploadQueueSize),
		objectDeletes:     make(chan string, objectDeleteQueueSize),
		snapshotDB:        snapshotDB,
		stopDatabaseSync:  make(chan struct{}),
		syncInterval:      config.SyncInterval,
	}

	manager.wg.Add(1)
	go manager.runDatabaseSyncLoop()

	for range mediaUploadWorkerCount {
		manager.wg.Add(1)
		go manager.runMediaUploadWorker()
	}

	manager.wg.Add(1)
	go manager.runObjectDeleteWorker()

	manager.NotifyDatabaseChanged()

	return manager, nil
}

// NotifyDatabaseChanged marks the SQLite snapshot as dirty for the next periodic sync.
// Example: `manager.NotifyDatabaseChanged()`
func (m *r2Manager) NotifyDatabaseChanged() {
	if m == nil || m.closing.Load() {
		return
	}

	m.databaseDirty.Store(true)
}

// Shutdown stops the workers after flushing a final SQLite snapshot.
// Example: `if err := manager.Shutdown(ctx); err != nil { return err }`
func (m *r2Manager) Shutdown(ctx context.Context) error {
	if m == nil {
		return nil
	}

	var shutdownErr error
	m.shutdownOnce.Do(func() {
		m.closing.Store(true)
		close(m.stopDatabaseSync)

		if err := m.syncDatabaseSnapshot(ctx); err != nil {
			shutdownErr = err
		}

		close(m.mediaUploads)
		close(m.objectDeletes)
		m.wg.Wait()

		if err := m.snapshotDB.Close(); err != nil && shutdownErr == nil {
			shutdownErr = fmt.Errorf("close snapshot database: %w", err)
		}
	})

	return shutdownErr
}

// mediaObjectKey returns the stable R2 object key for a WhatsApp attachment.
// Example: `key := manager.mediaObjectKey(chatJID, messageID, ".jpg")`
func (m *r2Manager) mediaObjectKey(chatJID string, messageID types.MessageID, extension string) string {
	prefix := strings.Trim(m.mediaPrefix, "/")
	if prefix == "" {
		return fmt.Sprintf("%s/%s%s", sanitizePathSegment(chatJID), sanitizePathSegment(string(messageID)), extension)
	}

	return fmt.Sprintf("%s/%s/%s%s", prefix, sanitizePathSegment(chatJID), sanitizePathSegment(string(messageID)), extension)
}

// enqueueMediaUpload schedules a background upload without blocking message storage.
// Example: `manager.enqueueMediaUpload(job)`
func (m *r2Manager) enqueueMediaUpload(job mediaUploadJob) {
	if m == nil || m.closing.Load() {
		return
	}

	defer func() {
		recover()
	}()

	select {
	case m.mediaUploads <- job:
	default:
		go m.enqueueMediaUploadSlow(job)
	}
}

// enqueueMediaDelete schedules a background R2 object deletion.
// Example: `manager.enqueueMediaDelete(mediaURI)`
func (m *r2Manager) enqueueMediaDelete(mediaURI string) {
	if m == nil || m.closing.Load() {
		return
	}

	bucket, objectKey, ok := parseR2ObjectURI(mediaURI)
	if !ok || bucket != m.bucket {
		return
	}

	defer func() {
		recover()
	}()

	select {
	case m.objectDeletes <- objectKey:
	default:
		go m.enqueueMediaDeleteSlow(objectKey)
	}
}

// enqueueMediaUploadSlow waits briefly for queue space without blocking callers.
// Example: `go manager.enqueueMediaUploadSlow(job)`
func (m *r2Manager) enqueueMediaUploadSlow(job mediaUploadJob) {
	defer func() {
		recover()
	}()

	timer := time.NewTimer(10 * time.Second)
	defer timer.Stop()

	select {
	case m.mediaUploads <- job:
	case <-timer.C:
		log.Printf("drop media upload for %s/%s: queue is saturated", job.chatJID, job.messageID)
	}
}

// enqueueMediaDeleteSlow waits briefly for queue space without blocking callers.
// Example: `go manager.enqueueMediaDeleteSlow(objectKey)`
func (m *r2Manager) enqueueMediaDeleteSlow(objectKey string) {
	defer func() {
		recover()
	}()

	timer := time.NewTimer(10 * time.Second)
	defer timer.Stop()

	select {
	case m.objectDeletes <- objectKey:
	case <-timer.C:
		log.Printf("drop media delete for %s: queue is saturated", objectKey)
	}
}

// runDatabaseSyncLoop uploads the SQLite snapshot on a fixed interval whenever writes happened.
// Example: `go manager.runDatabaseSyncLoop()`
func (m *r2Manager) runDatabaseSyncLoop() {
	defer m.wg.Done()

	ticker := time.NewTicker(m.syncInterval)
	defer ticker.Stop()

	for {
		select {
		case <-m.stopDatabaseSync:
			return
		case <-ticker.C:
			if !m.databaseDirty.Load() {
				continue
			}

			m.databaseDirty.Store(false)
			if err := m.syncDatabaseSnapshot(context.Background()); err != nil {
				m.databaseDirty.Store(true)
				log.Printf("periodic SQLite snapshot sync failed: %v", err)
			}
		}
	}
}

// runMediaUploadWorker uploads WhatsApp attachments to R2 in the background.
// Example: `go manager.runMediaUploadWorker()`
func (m *r2Manager) runMediaUploadWorker() {
	defer m.wg.Done()

	for job := range m.mediaUploads {
		if err := m.processMediaUpload(job); err != nil {
			log.Printf("upload media %s/%s failed: %v", job.chatJID, job.messageID, err)
		}
	}
}

// runObjectDeleteWorker deletes R2 objects for expired or revoked messages.
// Example: `go manager.runObjectDeleteWorker()`
func (m *r2Manager) runObjectDeleteWorker() {
	defer m.wg.Done()

	for objectKey := range m.objectDeletes {
		if err := m.deleteObject(context.Background(), objectKey); err != nil {
			log.Printf("delete media object %s failed: %v", objectKey, err)
		}
	}
}

// processMediaUpload downloads a WhatsApp attachment and streams it directly to R2.
// Example: `if err := manager.processMediaUpload(job); err != nil { ... }`
func (m *r2Manager) processMediaUpload(job mediaUploadJob) error {
	for attempt := 1; attempt <= 4; attempt++ {
		if !m.messageStillNeedsMedia(job.chatJID, job.messageID, job.objectURI) {
			return nil
		}

		payload, err := downloadWhatsAppMedia(job)
		if err != nil {
			if attempt == 4 {
				return err
			}

			time.Sleep(time.Duration(attempt) * 5 * time.Second)
			continue
		}

		if !m.messageStillNeedsMedia(job.chatJID, job.messageID, job.objectURI) {
			return nil
		}

		if err := m.uploadObject(context.Background(), job.objectKey, bytes.NewReader(payload), int64(len(payload)), job.mimeType); err != nil {
			if attempt == 4 {
				return err
			}

			time.Sleep(time.Duration(attempt) * 5 * time.Second)
			continue
		}

		return nil
	}

	return nil
}

// syncDatabaseSnapshot creates a consistent SQLite snapshot and uploads it to R2.
// Example: `if err := manager.syncDatabaseSnapshot(ctx); err != nil { return err }`
func (m *r2Manager) syncDatabaseSnapshot(ctx context.Context) error {
	if m == nil {
		return nil
	}

	m.databaseSyncMu.Lock()
	defer m.databaseSyncMu.Unlock()

	syncCtx, cancel := context.WithTimeout(ctx, databaseSyncTimeout)
	defer cancel()

	snapshotDir, err := os.MkdirTemp("", "whatsapp2sqlite-r2-*")
	if err != nil {
		return fmt.Errorf("create snapshot temp dir: %w", err)
	}
	defer os.RemoveAll(snapshotDir)

	snapshotPath := filepath.Join(snapshotDir, "whatsapp.sqlite")
	statement := fmt.Sprintf("VACUUM INTO %s", sqliteStringLiteral(snapshotPath))
	if _, err := m.snapshotDB.ExecContext(syncCtx, statement); err != nil {
		return fmt.Errorf("vacuum sqlite snapshot: %w", err)
	}

	file, err := os.Open(snapshotPath)
	if err != nil {
		return fmt.Errorf("open sqlite snapshot: %w", err)
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return fmt.Errorf("stat sqlite snapshot: %w", err)
	}

	return m.uploadObject(syncCtx, m.databaseObjectKey, file, info.Size(), "application/vnd.sqlite3")
}

// uploadObject writes a stream into R2.
// Example: `if err := manager.uploadObject(ctx, key, file, size, contentType); err != nil { ... }`
func (m *r2Manager) uploadObject(ctx context.Context, objectKey string, body io.Reader, contentLength int64, contentType string) error {
	uploadCtx, cancel := context.WithTimeout(ctx, mediaUploadTimeout)
	defer cancel()

	_, err := m.client.PutObject(uploadCtx, &s3.PutObjectInput{
		Bucket:        aws.String(m.bucket),
		ContentLength: aws.Int64(contentLength),
		ContentType:   aws.String(contentType),
		Key:           aws.String(objectKey),
		Body:          body,
	})
	if err != nil {
		return fmt.Errorf("put object %s: %w", objectKey, err)
	}

	return nil
}

// deleteObject removes an existing object from R2.
// Example: `if err := manager.deleteObject(ctx, key); err != nil { ... }`
func (m *r2Manager) deleteObject(ctx context.Context, objectKey string) error {
	deleteCtx, cancel := context.WithTimeout(ctx, objectDeleteTimeout)
	defer cancel()

	_, err := m.client.DeleteObject(deleteCtx, &s3.DeleteObjectInput{
		Bucket: aws.String(m.bucket),
		Key:    aws.String(objectKey),
	})
	if err != nil {
		return fmt.Errorf("delete object %s: %w", objectKey, err)
	}

	return nil
}

// messageStillNeedsMedia skips uploads for rows that were already deleted or changed.
// Example: `if !manager.messageStillNeedsMedia(chatJID, messageID, mediaURI) { return nil }`
func (m *r2Manager) messageStillNeedsMedia(chatJID string, messageID types.MessageID, mediaURI string) bool {
	if m == nil || m.snapshotDB == nil {
		return false
	}

	var exists int
	row := m.snapshotDB.QueryRow(
		`SELECT 1
		FROM sync_messages
		WHERE chat_jid = ?
			AND message_id = ?
			AND COALESCE(media_path, '') = ?
		LIMIT 1`,
		chatJID,
		messageID,
		mediaURI,
	)
	if err := row.Scan(&exists); err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			log.Printf("check media upload state for %s/%s failed: %v", chatJID, messageID, err)
			return true
		}

		return false
	}

	return exists == 1
}

// downloadWhatsAppMedia fetches attachment bytes from WhatsApp with a bounded timeout.
// Example: `payload, err := downloadWhatsAppMedia(job)`
func downloadWhatsAppMedia(job mediaUploadJob) ([]byte, error) {
	downloadCtx, cancel := context.WithTimeout(context.Background(), mediaUploadTimeout)
	defer cancel()

	payload, err := job.client.Download(downloadCtx, job.downloadable)
	if err != nil {
		return nil, fmt.Errorf("download attachment: %w", err)
	}

	return payload, nil
}

// r2ObjectURI formats a stable R2 URI for persisted media references.
// Example: `uri := r2ObjectURI(bucket, objectKey)`
func r2ObjectURI(bucket, objectKey string) string {
	return fmt.Sprintf("r2://%s/%s", bucket, strings.TrimLeft(objectKey, "/"))
}

// parseR2ObjectURI extracts bucket and object key from an `r2://` URI.
// Example: `bucket, objectKey, ok := parseR2ObjectURI(mediaURI)`
func parseR2ObjectURI(value string) (string, string, bool) {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "r2" {
		return "", "", false
	}

	bucket := parsed.Host
	objectKey := strings.TrimPrefix(parsed.Path, "/")
	if bucket == "" || objectKey == "" {
		return "", "", false
	}

	return bucket, objectKey, true
}

// sqliteStringLiteral escapes a value for use inside a SQLite string literal.
// Example: `query := fmt.Sprintf("VACUUM INTO %s", sqliteStringLiteral(path))`
func sqliteStringLiteral(value string) string {
	return fmt.Sprintf("'%s'", strings.ReplaceAll(value, "'", "''"))
}

type daemon struct {
	client      *whatsmeow.Client
	db          *sql.DB
	r2          *r2Manager
	postgres    *postgresChatsSync
	fatalEvents chan error

	groupMetadataSyncRunning      atomic.Bool
	groupMetadataSyncPending      atomic.Bool
	contactDisplayNameSyncRunning atomic.Bool

	groupIQMu            sync.Mutex
	groupIQLastRequest   time.Time
	groupIQCooldownUntil time.Time

	eventPersistJobs chan eventPersistJob
	eventPersistWG   sync.WaitGroup
	eventPersistStop sync.Once
}

type eventPersistJob struct {
	name string
	run  func(ctx context.Context) error
}

type daemonConfig struct {
	DatabasePath         string `json:"database_path"`
	DatabaseSyncInterval string `json:"database_sync_interval"`
	PushName             string `json:"push_name"`
	PostgresDatabaseURL  string `json:"postgres_database_url"`
	R2AccessKeyID        string `json:"r2_access_key_id"`
	R2AccountID          string `json:"r2_account_id"`
	R2Bucket             string `json:"r2_bucket"`
	R2DatabaseObjectKey  string `json:"r2_database_object_key"`
	R2Endpoint           string `json:"r2_endpoint"`
	R2MediaPrefix        string `json:"r2_media_prefix"`
	R2SecretAccessKey    string `json:"r2_secret_access_key"`
	configDirectory      string `json:"-"`
}

type storedMediaInfo struct {
	mimeType string
	path     string
	sha256   string
}

type storedMessagePayload struct {
	id      types.MessageID
	message *waE2E.Message
	isEdit  bool
}

type r2ManagerConfig struct {
	AccessKeyID       string
	Bucket            string
	DatabaseObjectKey string
	DatabasePath      string
	Endpoint          string
	MediaPrefix       string
	SecretAccessKey   string
	SyncInterval      time.Duration
}

type r2Manager struct {
	bucket            string
	client            *s3.Client
	closing           atomic.Bool
	databaseDirty     atomic.Bool
	databaseObjectKey string
	databaseSyncMu    sync.Mutex
	mediaPrefix       string
	mediaUploads      chan mediaUploadJob
	objectDeletes     chan string
	shutdownOnce      sync.Once
	snapshotDB        *sql.DB
	stopDatabaseSync  chan struct{}
	syncInterval      time.Duration
	wg                sync.WaitGroup
}

type mediaUploadJob struct {
	chatJID      string
	client       *whatsmeow.Client
	downloadable whatsmeow.DownloadableMessage
	messageID    types.MessageID
	mimeType     string
	objectKey    string
	objectURI    string
}

type syncChatMetadata struct {
	chatJID     string
	displayName string
	updatedAt   int64
}

type groupSyncResult struct {
	skippedRoster bool
}

type contactIdentity struct {
	contactJID  string
	phoneNumber string
	lidJID      string
	phoneJID    types.JID
	lid         types.JID
}

type contactNames struct {
	firstName    string
	fullName     string
	pushName     string
	businessName string
}

type contactRecord struct {
	contactJID   string
	phoneNumber  string
	lidJID       string
	firstName    string
	fullName     string
	pushName     string
	businessName string
	updatedAt    int64
}

type contactExecer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}
