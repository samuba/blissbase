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
	mediaUploadTimeout          = 2 * time.Minute
	objectDeleteTimeout         = 30 * time.Second
	mediaUploadWorkerCount      = 4
	mediaUploadQueueSize        = 256
	objectDeleteQueueSize       = 256
	defaultR2DatabaseObjectKey  = "whatsapp.sqlite"
	defaultR2MediaPrefix        = "media"
)

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

	daemon := &daemon{
		client:      client,
		db:          db,
		r2:          r2Manager,
		fatalEvents: make(chan error, 1),
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), databaseSyncTimeout)
		defer cancel()
		if err := daemon.shutdown(shutdownCtx); err != nil {
			log.Printf("shutdown R2 workers failed: %v", err)
		}
	}()

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
	query.Add("_pragma", "busy_timeout(5000)")
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
		if err := d.storeMessage(context.Background(), event, "realtime"); err != nil {
			log.Printf("store realtime message failed: %v", err)
		}
	case *events.HistorySync:
		if err := d.storeHistorySync(context.Background(), event); err != nil {
			log.Printf("store history sync failed: %v", err)
		}
	case *events.Connected:
		log.Printf("connected as %s", d.client.Store.ID)
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
			display_name = excluded.display_name,
			username = excluded.username,
			last_message_timestamp = excluded.last_message_timestamp,
			unread_count = excluded.unread_count,
			archived = excluded.archived,
			raw_conversation_json = excluded.raw_conversation_json,
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

	d.notifyDatabaseChanged()
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
	if d == nil || d.r2 == nil {
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
	fatalEvents chan error
}

type daemonConfig struct {
	DatabasePath         string `json:"database_path"`
	DatabaseSyncInterval string `json:"database_sync_interval"`
	PushName             string `json:"push_name"`
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
