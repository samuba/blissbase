package test

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	w2s "blissbase/whatsapp2sqlite"
)

func TestEnqueueEventPersistDropsWhenSaturated(t *testing.T) {
	t.Parallel()

	d := w2s.NewTestDaemonPersistQueue(2)

	d.EnqueueEventPersist(`a`, func(context.Context) error { return nil })
	d.EnqueueEventPersist(`b`, func(context.Context) error { return nil })
	d.EnqueueEventPersist(`c`, func(context.Context) error {
		t.Fatal(`dropped job should not run`)
		return nil
	})

	if d.EventPersistQueueLen() != 2 {
		t.Fatalf(`queue len = %d, want 2`, d.EventPersistQueueLen())
	}
}

func TestEventPersistWorkerRunsAndSoftStop(t *testing.T) {
	t.Parallel()

	d := w2s.NewTestDaemonPersistQueue(8)
	d.StartEventPersistWorker()

	var ran atomic.Bool
	d.EnqueueEventPersist(`job`, func(ctx context.Context) error {
		ran.Store(true)
		return nil
	})

	deadline := time.Now().Add(2 * time.Second)
	for !ran.Load() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if !ran.Load() {
		t.Fatal(`job did not run`)
	}

	d.StopEventPersistWorker()
	d.StopEventPersistWorker()
}

func TestWakePostgresChatWorkerNonBlocking(t *testing.T) {
	t.Parallel()

	d := w2s.NewTestDaemonWakeQueue(1)

	d.WakePostgresChatWorker()
	d.WakePostgresChatWorker()

	if d.PostgresWakeQueueLen() != 1 {
		t.Fatalf(`wake queue len = %d`, d.PostgresWakeQueueLen())
	}
}

func TestSyncChatToPostgresQueuesPending(t *testing.T) {
	t.Parallel()

	d := w2s.NewTestDaemonWithPostgres(openTestDB(t))

	d.SyncChatToPostgres(` chat@s.whatsapp.net `)
	d.SyncChatToPostgres(`chat@s.whatsapp.net`)

	if d.PendingPostgresChatCount() != 1 {
		t.Fatalf(`pending count = %d`, d.PendingPostgresChatCount())
	}
	if !d.HasPendingPostgresChat(`chat@s.whatsapp.net`) {
		t.Fatal(`missing pending chat jid`)
	}
}
