package test

import (
	"context"
	"testing"
	"time"

	w2s "blissbase/whatsapp2sqlite"

	waCommon "go.mau.fi/whatsmeow/proto/waCommon"
	waE2E "go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

func TestStoreMessageInsertEditRevoke(t *testing.T) {
	t.Parallel()

	db := openTestDB(t)
	d := w2s.NewTestDaemon(db)
	ctx := context.Background()
	chat := userJID(`491701111111`)
	sender := userJID(`491702222222`)
	now := time.Now()

	evt := textMessageEvent(textMessageParams{
		chat:   chat,
		sender: sender,
		id:     `msg1`,
		text:   `hello`,
		ts:     now,
	})
	if err := d.StoreMessage(ctx, evt, `realtime`); err != nil {
		t.Fatalf(`insert: %v`, err)
	}

	text, isEdit, ok := messageText(t, db, chat.String(), `msg1`)
	if !ok || text != `hello` || isEdit {
		t.Fatalf(`after insert: text=%q isEdit=%v ok=%v`, text, isEdit, ok)
	}

	edit := &events.Message{
		Info: types.MessageInfo{
			MessageSource: types.MessageSource{Chat: chat, Sender: sender},
			ID:            `edit-envelope`,
			Timestamp:     now.Add(time.Minute),
		},
		IsEdit: true,
		Message: &waE2E.Message{
			ProtocolMessage: &waE2E.ProtocolMessage{
				Type: waE2E.ProtocolMessage_MESSAGE_EDIT.Enum(),
				Key:  &waCommon.MessageKey{ID: proto.String(`msg1`)},
				EditedMessage: &waE2E.Message{
					Conversation: proto.String(`hello edited`),
				},
			},
		},
	}
	if err := d.StoreMessage(ctx, edit, `realtime`); err != nil {
		t.Fatalf(`edit: %v`, err)
	}

	text, isEdit, ok = messageText(t, db, chat.String(), `msg1`)
	if !ok || text != `hello edited` || !isEdit {
		t.Fatalf(`after edit: text=%q isEdit=%v ok=%v`, text, isEdit, ok)
	}

	revoke := &events.Message{
		Info: types.MessageInfo{
			MessageSource: types.MessageSource{Chat: chat, Sender: sender},
			ID:            `revoke-envelope`,
			Timestamp:     now.Add(2 * time.Minute),
		},
		Message: &waE2E.Message{
			ProtocolMessage: &waE2E.ProtocolMessage{
				Type: waE2E.ProtocolMessage_REVOKE.Enum(),
				Key:  &waCommon.MessageKey{ID: proto.String(`msg1`)},
			},
		},
	}
	if err := d.StoreMessage(ctx, revoke, `realtime`); err != nil {
		t.Fatalf(`revoke: %v`, err)
	}

	if countMessages(t, db, chat.String(), `msg1`) != 0 {
		t.Fatal(`message should be deleted after revoke`)
	}
}

func TestStoreMessageSkipsOutsideRetention(t *testing.T) {
	t.Parallel()

	db := openTestDB(t)
	d := w2s.NewTestDaemon(db)
	chat := userJID(`491701111111`)
	sender := userJID(`491702222222`)

	evt := textMessageEvent(textMessageParams{
		chat:   chat,
		sender: sender,
		id:     `old`,
		text:   `ancient`,
		ts:     time.Now().Add(-w2s.TestMessageRetentionWindow - time.Hour),
	})
	if err := d.StoreMessage(context.Background(), evt, `realtime`); err != nil {
		t.Fatalf(`store: %v`, err)
	}
	if countMessages(t, db, chat.String(), `old`) != 0 {
		t.Fatal(`expired message should not be stored`)
	}
}

func TestDeleteExpiredMessages(t *testing.T) {
	t.Parallel()

	db := openTestDB(t)
	d := w2s.NewTestDaemon(db)
	ctx := context.Background()
	now := time.Now()
	chat := userJID(`491701111111`).String()

	_, err := db.ExecContext(ctx, `
		INSERT INTO sync_messages (
			chat_jid, message_id, sender_jid, timestamp, is_from_me, is_group,
			source, updated_at, media_path
		) VALUES (?, 'old', 's', ?, 0, 0, 'realtime', ?, 'r2://bucket/media/old.jpg'),
		       (?, 'new', 's', ?, 0, 0, 'realtime', ?, NULL)
	`, chat, now.Add(-w2s.TestMessageRetentionWindow-time.Hour).Unix(), now.Unix(),
		chat, now.Unix(), now.Unix())
	if err != nil {
		t.Fatalf(`seed: %v`, err)
	}

	if err := d.DeleteExpiredMessages(ctx, now); err != nil {
		t.Fatalf(`deleteExpiredMessages: %v`, err)
	}

	if countMessages(t, db, chat, `old`) != 0 {
		t.Fatal(`old message should be deleted`)
	}
	if countMessages(t, db, chat, `new`) != 1 {
		t.Fatal(`new message should remain`)
	}
}

func TestApplyGroupMembershipJoinAndLeave(t *testing.T) {
	t.Parallel()

	db := openTestDB(t)
	d := w2s.NewTestDaemon(db)
	ctx := context.Background()
	group := groupJID(`120363testgroup`)
	member := userJID(`491703333333`)
	updatedAt := time.Now().Unix()

	joinEvt := &events.GroupInfo{
		JID:  group,
		Join: []types.JID{member},
	}
	if err := d.ApplyGroupMembershipChanges(ctx, joinEvt, updatedAt); err != nil {
		t.Fatalf(`join: %v`, err)
	}

	var left int
	err := db.QueryRow(
		`SELECT left_group FROM group_contacts WHERE group_jid = ? AND contact_jid = ?`,
		group.String(),
		member.String(),
	).Scan(&left)
	if err != nil {
		t.Fatalf(`query join: %v`, err)
	}
	if left != 0 {
		t.Fatalf(`left_group after join = %d`, left)
	}

	leaveEvt := &events.GroupInfo{
		JID:   group,
		Leave: []types.JID{member},
	}
	if err := d.ApplyGroupMembershipChanges(ctx, leaveEvt, updatedAt+1); err != nil {
		t.Fatalf(`leave: %v`, err)
	}

	err = db.QueryRow(
		`SELECT left_group FROM group_contacts WHERE group_jid = ? AND contact_jid = ?`,
		group.String(),
		member.String(),
	).Scan(&left)
	if err != nil {
		t.Fatalf(`query leave: %v`, err)
	}
	if left != 1 {
		t.Fatalf(`left_group after leave = %d`, left)
	}
}
