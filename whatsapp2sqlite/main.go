package main

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"log"
	"mime"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

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

const messageRetentionWindow = 30 * 24 * time.Hour

// main starts the long-running WhatsApp sync daemon.
// Example: `go run . -db ./whatsapp.sqlite`
func main() {
	config := parseConfig()

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	if err := run(ctx, config); err != nil && !errors.Is(err, context.Canceled) {
		log.Fatal(err)
	}
}

// run opens SQLite, initializes WhatsApp, and blocks until shutdown.
// Example: `if err := run(ctx, config); err != nil { log.Fatal(err) }`
func run(ctx context.Context, config daemonConfig) error {
	dbPath, err := filepath.Abs(config.DatabasePath)
	if err != nil {
		return fmt.Errorf("resolve database path: %w", err)
	}

	mediaPath, err := filepath.Abs(config.MediaDirectory)
	if err != nil {
		return fmt.Errorf("resolve media path: %w", err)
	}

	if err := os.MkdirAll(mediaPath, 0o755); err != nil {
		return fmt.Errorf("create media directory: %w", err)
	}

	db, err := openDatabase(dbPath)
	if err != nil {
		return err
	}
	defer db.Close()

	if err := ensureSchema(ctx, db); err != nil {
		return err
	}

	if err := deleteExpiredMessages(ctx, db, time.Now()); err != nil {
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

	daemon := &daemon{
		client:      client,
		db:          db,
		mediaDir:    mediaPath,
		fatalEvents: make(chan error, 1),
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

// parseConfig reads daemon flags.
// Example: `config := parseConfig()`
func parseConfig() daemonConfig {
	var config daemonConfig

	flag.StringVar(&config.DatabasePath, "db", "./whatsapp.sqlite", "SQLite database file for session state and synced messages")
	flag.StringVar(&config.MediaDirectory, "media-dir", "./media", "Directory where downloaded WhatsApp media files are stored")
	flag.StringVar(&config.PushName, "push-name", "Blissbase Sync", "push name stored for this linked device")
	flag.Parse()

	return config
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

	return nil
}

// storeMessage upserts a parsed WhatsApp message into SQLite.
// Example: `if err := d.storeMessage(ctx, evt, "realtime"); err != nil { return err }`
func (d *daemon) storeMessage(ctx context.Context, evt *events.Message, source string) error {
	if evt == nil {
		return nil
	}

	now := time.Now()
	if err := deleteExpiredMessages(ctx, d.db, now); err != nil {
		return err
	}

	if evt.Info.Timestamp.Before(messageRetentionCutoff(now)) {
		return nil
	}

	if revokedID := getRevokedMessageID(evt); revokedID != "" {
		return d.deleteRevokedMessage(ctx, evt.Info.Chat.String(), revokedID)
	}

	payload := getStoredMessagePayload(evt)
	messageID := payload.id
	message := payload.message
	messageType, textValue := describeMessage(message)
	mediaInfo, err := d.downloadMedia(ctx, evt, messageID, message)
	if err != nil {
		log.Printf("download media for %s/%s failed: %v", evt.Info.Chat, messageID, err)
	}
	senderPhoneNumber := extractSenderPhoneNumber(evt.Info.Sender, evt.Info.SenderAlt)

	_, err = d.db.ExecContext(
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

	return nil
}

// deleteExpiredMessages removes synced messages older than the retention window.
// Example: `if err := deleteExpiredMessages(ctx, db, time.Now()); err != nil { return err }`
func deleteExpiredMessages(ctx context.Context, db *sql.DB, now time.Time) error {
	if db == nil {
		return nil
	}

	tx, err := db.BeginTx(ctx, nil)
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
		if err := deleteFileIfExists(mediaPath); err != nil {
			return err
		}
	}

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
		if err := deleteFileIfExists(mediaPath); err != nil {
			log.Printf("delete media for revoked message %s/%s failed: %v", chatJID, messageID, err)
		}
	}

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

// deleteFileIfExists removes a file and ignores missing-file errors.
// Example: `if err := deleteFileIfExists(path); err != nil { return err }`
func deleteFileIfExists(path string) error {
	if path == "" {
		return nil
	}

	err := os.Remove(path)
	if err == nil || errors.Is(err, os.ErrNotExist) {
		return nil
	}

	return fmt.Errorf("delete media file %s: %w", path, err)
}

// messageRetentionCutoff returns the oldest timestamp that may remain stored.
// Example: `cutoff := messageRetentionCutoff(time.Now())`
func messageRetentionCutoff(now time.Time) time.Time {
	return now.Add(-messageRetentionWindow)
}

// downloadMedia saves a downloadable WhatsApp attachment and returns its persisted file metadata.
// Example: `mediaInfo, err := d.downloadMedia(ctx, evt, messageID, message)`
func (d *daemon) downloadMedia(ctx context.Context, evt *events.Message, messageID types.MessageID, message *waE2E.Message) (storedMediaInfo, error) {
	downloadable, mediaKind, mimeType, sha256 := getDownloadableMedia(message)
	if downloadable == nil {
		return storedMediaInfo{}, nil
	}

	chatDir := filepath.Join(d.mediaDir, sanitizePathSegment(evt.Info.Chat.String()))
	if err := os.MkdirAll(chatDir, 0o755); err != nil {
		return storedMediaInfo{}, fmt.Errorf("create chat media directory: %w", err)
	}

	extension := mediaExtension(mimeType, mediaKind)
	filePath := filepath.Join(chatDir, fmt.Sprintf("%s%s", sanitizePathSegment(messageID), extension))
	absolutePath, err := filepath.Abs(filePath)
	if err != nil {
		return storedMediaInfo{}, fmt.Errorf("resolve media file path: %w", err)
	}

	if _, err := os.Stat(absolutePath); err == nil {
		return storedMediaInfo{
			mimeType: mimeType,
			path:     absolutePath,
			sha256:   sha256,
		}, nil
	}

	if evt.Info.Timestamp.Before(messageRetentionCutoff(time.Now())) {
		return storedMediaInfo{
			mimeType: mimeType,
			sha256:   sha256,
		}, nil
	}

	downloadCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	payload, err := d.client.Download(downloadCtx, downloadable)
	if err != nil {
		return storedMediaInfo{}, fmt.Errorf("download attachment: %w", err)
	}

	if err := os.WriteFile(absolutePath, payload, 0o644); err != nil {
		return storedMediaInfo{}, fmt.Errorf("write media file: %w", err)
	}

	return storedMediaInfo{
		mimeType: mimeType,
		path:     absolutePath,
		sha256:   sha256,
	}, nil
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
	case message.GetReactionMessage() != nil:
		return "reaction", message.GetReactionMessage().GetText()
	case message.GetProtocolMessage() != nil:
		return "protocol", message.GetProtocolMessage().GetType().String()
	default:
		return strings.TrimPrefix(fmt.Sprintf("%T", message), "*waE2E."), ""
	}
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

type daemon struct {
	client      *whatsmeow.Client
	db          *sql.DB
	mediaDir    string
	fatalEvents chan error
}

type daemonConfig struct {
	DatabasePath   string
	MediaDirectory string
	PushName       string
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
