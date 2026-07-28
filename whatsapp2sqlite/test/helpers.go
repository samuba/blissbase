package test

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	w2s "blissbase/whatsapp2sqlite"

	waE2E "go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()

	path := filepath.Join(t.TempDir(), `test.sqlite`)
	db, err := w2s.TestOpenDatabase(path)
	if err != nil {
		t.Fatalf(`openDatabase: %v`, err)
	}
	t.Cleanup(func() { _ = db.Close() })

	if err := w2s.TestEnsureSchema(context.Background(), db); err != nil {
		t.Fatalf(`ensureSchema: %v`, err)
	}

	return db
}

func userJID(user string) types.JID {
	return types.NewJID(user, types.DefaultUserServer)
}

func groupJID(user string) types.JID {
	return types.NewJID(user, types.GroupServer)
}

type textMessageParams struct {
	chat   types.JID
	sender types.JID
	id     string
	text   string
	ts     time.Time
}

func textMessageEvent(p textMessageParams) *events.Message {
	return &events.Message{
		Info: types.MessageInfo{
			MessageSource: types.MessageSource{
				Chat:   p.chat,
				Sender: p.sender,
			},
			ID:        types.MessageID(p.id),
			Timestamp: p.ts,
		},
		Message: &waE2E.Message{
			Conversation: proto.String(p.text),
		},
	}
}

func countMessages(t *testing.T, db *sql.DB, chatJID, messageID string) int {
	t.Helper()

	var count int
	err := db.QueryRow(
		`SELECT COUNT(*) FROM sync_messages WHERE chat_jid = ? AND message_id = ?`,
		chatJID,
		messageID,
	).Scan(&count)
	if err != nil {
		t.Fatalf(`count messages: %v`, err)
	}

	return count
}

func messageText(t *testing.T, db *sql.DB, chatJID, messageID string) (text string, isEdit bool, ok bool) {
	t.Helper()

	var value sql.NullString
	var editFlag int
	err := db.QueryRow(
		`SELECT text_value, is_edit FROM sync_messages WHERE chat_jid = ? AND message_id = ?`,
		chatJID,
		messageID,
	).Scan(&value, &editFlag)
	if err == sql.ErrNoRows {
		return ``, false, false
	}
	if err != nil {
		t.Fatalf(`read message: %v`, err)
	}

	return value.String, editFlag == 1, true
}
