package test

import (
	"context"
	"database/sql"
	"testing"
	"time"

	w2s "blissbase/whatsapp2sqlite"

	_ "github.com/bradfitz/gopglite"
)

func openPGlite(t *testing.T) *sql.DB {
	t.Helper()

	db, err := sql.Open(`pglite`, `:memory:`)
	if err != nil {
		t.Fatalf(`sql.Open pglite: %v`, err)
	}
	t.Cleanup(func() { _ = db.Close() })

	_, err = db.Exec(`
		CREATE TABLE whatsapp_chats (
			chat_jid text PRIMARY KEY,
			name text NOT NULL,
			last_message_time timestamptz,
			hidden boolean NOT NULL DEFAULT false,
			created_at timestamptz NOT NULL DEFAULT now(),
			updated_at timestamptz
		)
	`)
	if err != nil {
		t.Fatalf(`create whatsapp_chats: %v`, err)
	}

	return db
}

func TestWhatsappChatUpsertLastMessageTimeMonotonic(t *testing.T) {
	db := openPGlite(t)
	ctx := context.Background()
	jid := `120363group@g.us`
	t100 := time.Unix(100, 0).UTC()
	t90 := time.Unix(90, 0).UTC()
	t110 := time.Unix(110, 0).UTC()
	updated := time.Unix(200, 0).UTC()

	if err := w2s.TestExecWhatsappChatUpsert(ctx, db, w2s.NamedSyncChat{
		ChatJID:         jid,
		Name:            `Alpha`,
		LastMessageTime: &t100,
		UpdatedAt:       updated,
	}); err != nil {
		t.Fatalf(`insert: %v`, err)
	}

	if err := w2s.TestExecWhatsappChatUpsert(ctx, db, w2s.NamedSyncChat{
		ChatJID:         jid,
		Name:            `Alpha`,
		LastMessageTime: &t90,
		UpdatedAt:       updated.Add(time.Second),
	}); err != nil {
		t.Fatalf(`older upsert: %v`, err)
	}
	assertLastMessageUnix(t, db, jid, 100)

	if err := w2s.TestExecWhatsappChatUpsert(ctx, db, w2s.NamedSyncChat{
		ChatJID:         jid,
		Name:            `Alpha Renamed`,
		LastMessageTime: nil,
		UpdatedAt:       updated.Add(2 * time.Second),
	}); err != nil {
		t.Fatalf(`null upsert: %v`, err)
	}
	assertLastMessageUnix(t, db, jid, 100)

	var name string
	if err := db.QueryRow(`SELECT name FROM whatsapp_chats WHERE chat_jid = $1`, jid).Scan(&name); err != nil {
		t.Fatalf(`name: %v`, err)
	}
	if name != `Alpha Renamed` {
		t.Fatalf(`name = %q`, name)
	}

	if err := w2s.TestExecWhatsappChatUpsert(ctx, db, w2s.NamedSyncChat{
		ChatJID:         jid,
		Name:            `Alpha Renamed`,
		LastMessageTime: &t110,
		UpdatedAt:       updated.Add(3 * time.Second),
	}); err != nil {
		t.Fatalf(`newer upsert: %v`, err)
	}
	assertLastMessageUnix(t, db, jid, 110)
}

func assertLastMessageUnix(t *testing.T, db *sql.DB, jid string, want int64) {
	t.Helper()

	var epoch float64
	err := db.QueryRow(
		`SELECT EXTRACT(EPOCH FROM last_message_time) FROM whatsapp_chats WHERE chat_jid = $1`,
		jid,
	).Scan(&epoch)
	if err != nil {
		t.Fatalf(`scan last_message_time: %v`, err)
	}
	if int64(epoch) != want {
		t.Fatalf(`last_message_time unix = %d, want %d`, int64(epoch), want)
	}
}
