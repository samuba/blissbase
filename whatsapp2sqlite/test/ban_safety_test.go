package test

import (
	"context"
	"errors"
	"testing"
	"time"

	w2s "blissbase/whatsapp2sqlite"

	"go.mau.fi/whatsmeow"
)

func TestRosterLooksFresh(t *testing.T) {
	t.Parallel()

	d := w2s.NewTestDaemonBare()
	now := time.Now().Unix()

	cases := []struct {
		name       string
		localCount int
		updatedAt  int64
		listCount  int
		want       bool
	}{
		{name: `zero local`, localCount: 0, updatedAt: now, listCount: 10, want: false},
		{name: `zero updated`, localCount: 10, updatedAt: 0, listCount: 10, want: false},
		{name: `exact match fresh`, localCount: 10, updatedAt: now, listCount: 10, want: true},
		{name: `small absolute drift`, localCount: 12, updatedAt: now, listCount: 10, want: true},
		{name: `large relative drift`, localCount: 20, updatedAt: now, listCount: 10, want: false},
		{name: `stale age`, localCount: 10, updatedAt: now - int64((25 * time.Hour).Seconds()), listCount: 10, want: false},
		{name: `list count zero skips delta`, localCount: 10, updatedAt: now, listCount: 0, want: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := d.RosterLooksFresh(tc.localCount, tc.updatedAt, tc.listCount); got != tc.want {
				t.Fatalf(`rosterLooksFresh() = %v, want %v`, got, tc.want)
			}
		})
	}
}

func TestIsGroupIQRateOverLimit(t *testing.T) {
	t.Parallel()

	if w2s.TestIsGroupIQRateOverLimit(nil) {
		t.Fatal(`nil`)
	}
	if !w2s.TestIsGroupIQRateOverLimit(whatsmeow.ErrIQRateOverLimit) {
		t.Fatal(`ErrIQRateOverLimit`)
	}
	if !w2s.TestIsGroupIQRateOverLimit(errors.New(`iq error rate-overlimit from server`)) {
		t.Fatal(`string match`)
	}
	if w2s.TestIsGroupIQRateOverLimit(errors.New(`something else`)) {
		t.Fatal(`unrelated error`)
	}
}

func TestAwaitGroupIQCooldown(t *testing.T) {
	t.Parallel()

	d := w2s.NewTestDaemonBare()
	d.MarkGroupIQRateLimited()

	err := d.AwaitGroupIQ(context.Background())
	if !errors.Is(err, w2s.TestErrGroupIQCoolingDown) {
		t.Fatalf(`got %v, want errGroupIQCoolingDown`, err)
	}
}

func TestAwaitGroupIQSpacing(t *testing.T) {
	restore := w2s.TestSetGroupIQMinInterval(30 * time.Millisecond)
	t.Cleanup(restore)

	d := w2s.NewTestDaemonBare()
	if err := d.AwaitGroupIQ(context.Background()); err != nil {
		t.Fatalf(`first: %v`, err)
	}

	started := time.Now()
	if err := d.AwaitGroupIQ(context.Background()); err != nil {
		t.Fatalf(`second: %v`, err)
	}
	elapsed := time.Since(started)
	if elapsed < 20*time.Millisecond {
		t.Fatalf(`expected spacing wait, elapsed %s`, elapsed)
	}
}

func TestAwaitGroupIQContextCancel(t *testing.T) {
	restore := w2s.TestSetGroupIQMinInterval(time.Hour)
	t.Cleanup(restore)

	d := w2s.NewTestDaemonBare()
	d.SetGroupIQLastRequest(time.Now())

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := d.AwaitGroupIQ(ctx)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf(`got %v, want context.Canceled`, err)
	}
}
