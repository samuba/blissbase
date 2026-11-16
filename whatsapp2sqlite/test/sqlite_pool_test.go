package test

import (
	"context"
	"testing"
	"time"

	w2s "blissbase/whatsapp2sqlite"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	waLog "go.mau.fi/whatsmeow/util/log"
)

// An unnamed DM makes the connect-time contact backfill look up a LID while its
// chat query is still open. With MaxOpenConns(1) that self-deadlocks, and every
// incoming whatsmeow node then waits forever on the same connection.
func TestBackfillContactDisplayNamesDoesNotHoldSQLiteConn(t *testing.T) {
	t.Parallel()

	db := openTestDB(t)
	ctx := context.Background()

	container := sqlstore.NewWithDB(db, `sqlite`, waLog.Noop)
	if err := container.Upgrade(ctx); err != nil {
		t.Fatalf(`upgrade whatsmeow store: %v`, err)
	}

	ownID := types.NewJID(`4915110777450`, types.DefaultUserServer)
	ownID.Device = 26
	device := container.NewDevice()
	device.ID = &ownID
	device.SetAllStores(sqlstore.NewSQLStore(container, ownID))
	device.LIDs = container.LIDMap
	client := whatsmeow.NewClient(device, waLog.Noop)

	_, err := db.ExecContext(
		ctx,
		`INSERT INTO sync_chats (chat_jid, display_name, updated_at) VALUES (?, '', ?)`,
		`4915110777450@s.whatsapp.net`,
		time.Now().Unix(),
	)
	if err != nil {
		t.Fatalf(`insert unnamed chat: %v`, err)
	}

	daemon := w2s.NewTestDaemon(db)
	daemon.SetClient(client)

	done := make(chan error, 1)
	go func() {
		done <- daemon.BackfillContactDisplayNames(ctx)
	}()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf(`backfill contact display names: %v`, err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal(`backfill held the only sqlite connection across a LID lookup`)
	}
}
