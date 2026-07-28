package whatsapp2sqlite

import (
	"context"
	"database/sql"
	"time"

	waE2E "go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

// Test hooks for blissbase/whatsapp2sqlite/test.

const (
	TestMessageRetentionWindow     = messageRetentionWindow
	TestDefaultR2DatabaseObjectKey = defaultR2DatabaseObjectKey
	TestDefaultR2MediaPrefix       = defaultR2MediaPrefix
)

var TestErrGroupIQCoolingDown = errGroupIQCoolingDown

func TestOpenDatabase(path string) (*sql.DB, error) { return openDatabase(path) }
func TestEnsureSchema(ctx context.Context, db *sql.DB) error {
	return ensureSchema(ctx, db)
}
func TestShouldStoreMessage(message *waE2E.Message) bool { return shouldStoreMessage(message) }
func TestDescribeMessage(message *waE2E.Message) (string, string) {
	return describeMessage(message)
}
func TestNormalizePhoneNumberJID(jid types.JID) string { return normalizePhoneNumberJID(jid) }
func TestExtractSenderPhoneNumber(sender, senderAlt types.JID) string {
	return extractSenderPhoneNumber(sender, senderAlt)
}
func TestMessageRetentionCutoff(now time.Time) time.Time { return messageRetentionCutoff(now) }
func TestMediaExtension(mimeType, mediaKind string) string {
	return mediaExtension(mimeType, mediaKind)
}
func TestSanitizePathSegment(value string) string              { return sanitizePathSegment(value) }
func TestParseR2ObjectURI(value string) (string, string, bool) { return parseR2ObjectURI(value) }
func TestR2ObjectURI(bucket, objectKey string) string          { return r2ObjectURI(bucket, objectKey) }
func TestStripJSONCComments(data []byte) []byte                { return stripJSONCComments(data) }
func TestSqliteStringLiteral(value string) string              { return sqliteStringLiteral(value) }
func TestIsTransientPostgresError(err error) bool              { return isTransientPostgresError(err) }
func TestGetRevokedMessageID(evt *events.Message) types.MessageID {
	return getRevokedMessageID(evt)
}
func TestFirstNonEmpty(values ...string) string  { return firstNonEmpty(values...) }
func TestIsGroupIQRateOverLimit(err error) bool  { return isGroupIQRateOverLimit(err) }
func TestLoadConfig(path string) (Config, error) { return loadConfig(path) }

// Config is the daemon JSONC config (exported for tests).
type Config = daemonConfig

func (c daemonConfig) Validate() error { return c.validate() }
func (c daemonConfig) ExposedR2Endpoint() string {
	return c.r2Endpoint()
}
func (c daemonConfig) ResolvePath(value string) (string, error) {
	return c.resolvePath(value)
}

// NamedSyncChat is the Postgres mirror row shape (exported for tests).
type NamedSyncChat struct {
	ChatJID         string
	Name            string
	LastMessageTime *time.Time
	UpdatedAt       time.Time
}

func TestExecWhatsappChatUpsert(ctx context.Context, db *sql.DB, chat NamedSyncChat) error {
	return execWhatsappChatUpsert(ctx, db, namedSyncChat{
		chatJID:         chat.ChatJID,
		name:            chat.Name,
		lastMessageTime: chat.LastMessageTime,
		updatedAt:       chat.UpdatedAt,
	})
}

// TestDaemon wraps daemon for external tests.
type TestDaemon struct {
	d *daemon
}

func NewTestDaemon(db *sql.DB) *TestDaemon {
	return &TestDaemon{
		d: &daemon{
			db:                   db,
			eventPersistJobs:     make(chan eventPersistJob, eventPersistQueueSize),
			postgresChatWake:     make(chan struct{}, postgresChatWakeQueueSize),
			pendingPostgresChats: make(map[string]struct{}),
		},
	}
}

func NewTestDaemonPersistQueue(size int) *TestDaemon {
	return &TestDaemon{
		d: &daemon{
			eventPersistJobs: make(chan eventPersistJob, size),
		},
	}
}

func NewTestDaemonWakeQueue(size int) *TestDaemon {
	return &TestDaemon{
		d: &daemon{
			postgresChatWake: make(chan struct{}, size),
		},
	}
}

func NewTestDaemonWithPostgres(db *sql.DB) *TestDaemon {
	return &TestDaemon{
		d: &daemon{
			db:                   db,
			postgres:             &postgresChatsSync{},
			postgresChatWake:     make(chan struct{}, 4),
			pendingPostgresChats: make(map[string]struct{}),
		},
	}
}

func NewTestDaemonBare() *TestDaemon {
	return &TestDaemon{d: &daemon{}}
}

func (t *TestDaemon) RosterLooksFresh(localCount int, updatedAt int64, listCount int) bool {
	return t.d.rosterLooksFresh(localCount, updatedAt, listCount)
}

func (t *TestDaemon) MarkGroupIQRateLimited() { t.d.markGroupIQRateLimited() }

func (t *TestDaemon) AwaitGroupIQ(ctx context.Context) error {
	return t.d.awaitGroupIQ(ctx)
}

func (t *TestDaemon) SetGroupIQLastRequest(at time.Time) {
	t.d.groupIQLastRequest = at
}

func (t *TestDaemon) StoreMessage(ctx context.Context, evt *events.Message, source string) error {
	return t.d.storeMessage(ctx, evt, source)
}

func (t *TestDaemon) DeleteExpiredMessages(ctx context.Context, now time.Time) error {
	return t.d.deleteExpiredMessages(ctx, now)
}

func (t *TestDaemon) ApplyGroupMembershipChanges(ctx context.Context, evt *events.GroupInfo, updatedAt int64) error {
	return t.d.applyGroupMembershipChanges(ctx, evt, updatedAt)
}

func (t *TestDaemon) EnqueueEventPersist(name string, run func(ctx context.Context) error) {
	t.d.enqueueEventPersist(name, run)
}

func (t *TestDaemon) EventPersistQueueLen() int {
	return len(t.d.eventPersistJobs)
}

func (t *TestDaemon) StartEventPersistWorker() { t.d.startEventPersistWorker() }
func (t *TestDaemon) StopEventPersistWorker()  { t.d.stopEventPersistWorker() }

func (t *TestDaemon) WakePostgresChatWorker() { t.d.wakePostgresChatWorker() }

func (t *TestDaemon) PostgresWakeQueueLen() int {
	return len(t.d.postgresChatWake)
}

func (t *TestDaemon) SyncChatToPostgres(chatJID string) {
	t.d.syncChatToPostgres(chatJID)
}

func (t *TestDaemon) PendingPostgresChatCount() int {
	t.d.pendingPostgresMu.Lock()
	defer t.d.pendingPostgresMu.Unlock()
	return len(t.d.pendingPostgresChats)
}

func (t *TestDaemon) HasPendingPostgresChat(chatJID string) bool {
	t.d.pendingPostgresMu.Lock()
	defer t.d.pendingPostgresMu.Unlock()
	_, ok := t.d.pendingPostgresChats[chatJID]
	return ok
}

func TestSetGroupIQMinInterval(d time.Duration) (restore func()) {
	prev := groupIQMinInterval
	groupIQMinInterval = d
	return func() { groupIQMinInterval = prev }
}

func TestMediaObjectKey(mediaPrefix, chatJID string, messageID types.MessageID, extension string) string {
	m := &r2Manager{mediaPrefix: mediaPrefix}
	return m.mediaObjectKey(chatJID, messageID, extension)
}

func TestEnqueueMediaNilSafe() {
	var m *r2Manager
	m.enqueueMediaUpload(mediaUploadJob{})
	m.enqueueMediaDelete(`r2://bucket/media/x.jpg`)
}
