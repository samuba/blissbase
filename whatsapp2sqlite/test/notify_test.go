package test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	w2s "blissbase/whatsapp2sqlite"

	"go.mau.fi/whatsmeow/types/events"
)

func TestDecideNotificationStartsSuppressesAndRearms(t *testing.T) {
	t.Parallel()

	start := time.Date(2026, 9, 24, 12, 0, 0, 0, time.UTC)
	first, send := w2s.TestDecideNotification(w2s.TestIncidentState{}, start)
	if !send {
		t.Fatal(`first failure should send`)
	}
	if first.FailureCount != 1 || !first.Open {
		t.Fatalf(`first state = %+v`, first)
	}

	repeat, send := w2s.TestDecideNotification(first, start.Add(5*time.Second))
	if send {
		t.Fatal(`repeat inside the incident should not send`)
	}
	if repeat.FailureCount != 2 {
		t.Fatalf(`failure count = %d`, repeat.FailureCount)
	}

	recovered, send := w2s.TestDecideNotification(repeat, repeat.LastFailureAt.Add(w2s.TestNotifyIncidentRecovery))
	if !send {
		t.Fatal(`failure after the healthy gap should start a new incident`)
	}
	if recovered.FailureCount != 1 {
		t.Fatalf(`recovered count = %d`, recovered.FailureCount)
	}

	open := w2s.TestIncidentState{
		Open:           true,
		FailureCount:   4,
		LastFailureAt:  start.Add(w2s.TestNotifyIncidentCooldown - time.Second),
		LastNotifiedAt: start,
	}
	if _, send := w2s.TestDecideNotification(open, open.LastFailureAt); send {
		t.Fatal(`open incident should stay quiet inside the cooldown`)
	}

	released, send := w2s.TestDecideNotification(open, start.Add(w2s.TestNotifyIncidentCooldown))
	if !send {
		t.Fatal(`open incident should send again after the cooldown`)
	}
	if released.FailureCount != open.FailureCount+1 {
		t.Fatalf(`cooldown count = %d`, released.FailureCount)
	}
}

func TestShouldReportProcessErrorSkipsCleanShutdown(t *testing.T) {
	t.Parallel()

	if w2s.TestShouldReportProcessError(nil) {
		t.Fatal(`nil error should not notify`)
	}
	if w2s.TestShouldReportProcessError(context.Canceled) {
		t.Fatal(`clean shutdown should not notify`)
	}
	if w2s.TestShouldReportProcessError(errors.Join(errors.New(`connect`), context.Canceled)) {
		t.Fatal(`wrapped cancel should not notify`)
	}
	if !w2s.TestShouldReportProcessError(errors.New(`session logged out`)) {
		t.Fatal(`fatal error should notify`)
	}
}

func TestRedactNotificationSecrets(t *testing.T) {
	t.Parallel()

	got := w2s.TestRedactNotificationSecrets(
		`dial postgres://user:supersecret@db.example/postgres failed`,
		[]string{`postgres://user:supersecret@db.example/postgres`, `supersecret`, `short`},
	)
	if strings.Contains(got, `supersecret`) || strings.Contains(got, `postgres://`) {
		t.Fatalf(`secret leaked: %s`, got)
	}
	if !strings.Contains(got, `[redacted]`) {
		t.Fatalf(`redacted text = %s`, got)
	}
}

func TestPostSendNotificationContract(t *testing.T) {
	t.Parallel()

	var gotMethod, gotType string
	var payload map[string]string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotType = r.Header.Get(`Content-Type`)
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf(`read body: %v`, err)
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Errorf(`decode body: %v`, err)
		}
		w.Header().Set(`Content-Type`, `application/json`)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(server.Close)

	err := w2s.TestPostSendNotification(context.Background(), server.URL, `top-secret`, `Server error`, `Worker X crashed`)
	if err != nil {
		t.Fatalf(`post: %v`, err)
	}
	if gotMethod != http.MethodPost {
		t.Fatalf(`method = %s`, gotMethod)
	}
	if gotType != `application/json` {
		t.Fatalf(`content type = %s`, gotType)
	}
	if payload[`secretKey`] != `top-secret` || payload[`subject`] != `Server error` || payload[`text`] != `Worker X crashed` {
		t.Fatalf(`payload = %#v`, payload)
	}

	unauthorized := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `nope`, http.StatusUnauthorized)
	}))
	t.Cleanup(unauthorized.Close)
	if err := w2s.TestPostSendNotification(context.Background(), unauthorized.URL, `top-secret`, `Server error`, `Worker X crashed`); err == nil {
		t.Fatal(`expected unauthorized error`)
	}
}

func TestIncidentSurvivesRestartAndSeparateKinds(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), `incident.json`)
	start := time.Date(2026, 9, 24, 12, 0, 0, 0, time.UTC)
	var sends atomic.Int32

	first := newNotifier(t, path, start, &sends)
	first.ReportExit(errors.New(`session logged out`))
	if sends.Load() != 1 {
		t.Fatalf(`sends = %d, want 1`, sends.Load())
	}
	if first.ExitState().LastNotifiedAt.IsZero() {
		t.Fatal(`successful send should record lastNotifiedAt`)
	}

	restarted := newNotifier(t, path, start.Add(5*time.Second), &sends)
	restarted.ReportExit(errors.New(`session logged out`))
	if sends.Load() != 1 {
		t.Fatalf(`restart sent again, sends = %d`, sends.Load())
	}

	restarted.ReportDegraded(errors.New(`postgres full chat sync failed`))
	if sends.Load() != 2 {
		t.Fatalf(`degraded incident should send separately, sends = %d`, sends.Load())
	}

	healed := newNotifier(t, path, start.Add(5*time.Second).Add(w2s.TestNotifyIncidentRecovery), &sends)
	healed.ReportExit(errors.New(`connect WhatsApp client: timeout`))
	if sends.Load() != 3 {
		t.Fatalf(`new exit incident should send, sends = %d`, sends.Load())
	}
}

func TestFailedDeliveryRetriesAfterBackoff(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), `incident.json`)
	start := time.Date(2026, 9, 24, 12, 0, 0, 0, time.UTC)
	var sends atomic.Int32
	notifier := newNotifier(t, path, start, &sends)
	notifier.SetPost(func(subject, text string) error {
		sends.Add(1)
		return errors.New(`worker down`)
	})

	notifier.ReportExit(errors.New(`boom`))
	notifier.ReportExit(errors.New(`boom`))
	if sends.Load() != 1 {
		t.Fatalf(`sends = %d, want 1 before backoff`, sends.Load())
	}
	if !notifier.ExitState().LastNotifiedAt.IsZero() {
		t.Fatal(`failed delivery should not count as notified`)
	}

	notifier.SetNow(start.Add(w2s.TestNotifySendRetryAfter))
	notifier.ReportExit(errors.New(`boom`))
	if sends.Load() != 2 {
		t.Fatalf(`sends = %d, want retry after backoff`, sends.Load())
	}
}

func TestMissingSecretDoesNotConsumeIncident(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), `incident.json`)
	var sends atomic.Int32
	notifier := w2s.NewTestNotifier(path)
	notifier.SetNow(time.Date(2026, 9, 24, 12, 0, 0, 0, time.UTC))
	notifier.SetPost(func(subject, text string) error {
		sends.Add(1)
		if strings.Contains(text, `supersecret`) {
			t.Errorf(`secret leaked into notification: %s`, text)
		}
		return nil
	})
	notifier.SetSecrets([]string{`supersecret-password`})

	notifier.ReportExit(errors.New(`dial supersecret-password failed`))
	if sends.Load() != 0 {
		t.Fatal(`missing secret should not send`)
	}

	notifier.SetSecret(`worker-secret`)
	notifier.ReportExit(errors.New(`dial supersecret-password failed`))
	if sends.Load() != 1 {
		t.Fatalf(`sends = %d, want 1 after secret is set`, sends.Load())
	}
}

func TestOpenIncidentCooldownWhileStillFailing(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), `incident.json`)
	start := time.Date(2026, 9, 24, 12, 0, 0, 0, time.UTC)
	var sends atomic.Int32
	notifier := newNotifier(t, path, start, &sends)

	step := w2s.TestNotifyIncidentRecovery - time.Second
	var elapsed time.Duration
	for elapsed < w2s.TestNotifyIncidentCooldown {
		notifier.SetNow(start.Add(elapsed))
		notifier.ReportExit(errors.New(`still looping`))
		elapsed += step
	}
	if sends.Load() != 1 {
		t.Fatalf(`sends during loop = %d, want 1`, sends.Load())
	}

	notifier.SetNow(start.Add(w2s.TestNotifyIncidentCooldown))
	notifier.ReportExit(errors.New(`still looping`))
	if sends.Load() != 2 {
		t.Fatalf(`sends after cooldown = %d, want 2`, sends.Load())
	}
}

func TestEventPersistFailureNotifiesOnce(t *testing.T) {
	t.Parallel()

	var sends atomic.Int32
	notifier := newNotifier(t, filepath.Join(t.TempDir(), `incident.json`), time.Now(), &sends)
	daemon := w2s.NewTestDaemonPersistQueue(4)
	daemon.AttachNotifier(notifier)
	daemon.StartEventPersistWorker()
	daemon.EnqueueEventPersist(`boom`, func(context.Context) error {
		return errors.New(`disk full`)
	})
	daemon.EnqueueEventPersist(`boom-2`, func(context.Context) error {
		return errors.New(`disk full again`)
	})
	daemon.StopEventPersistWorker()

	if sends.Load() != 1 {
		t.Fatalf(`sends = %d, want 1`, sends.Load())
	}
}

func TestSaturatedPersistQueueNotifiesOnce(t *testing.T) {
	t.Parallel()

	var sends atomic.Int32
	notifier := newNotifier(t, filepath.Join(t.TempDir(), `incident.json`), time.Now(), &sends)
	daemon := w2s.NewTestDaemonPersistQueue(1)
	daemon.AttachNotifier(notifier)
	daemon.EnqueueEventPersist(`a`, func(context.Context) error { return nil })
	daemon.EnqueueEventPersist(`b`, func(context.Context) error { return nil })
	daemon.EnqueueEventPersist(`c`, func(context.Context) error { return nil })

	if sends.Load() != 1 {
		t.Fatalf(`sends = %d, want 1`, sends.Load())
	}
}

func TestRequireNotificationSecret(t *testing.T) {
	t.Setenv(`SEND_NOTIFICATION_SECRET_KEY`, ` `)
	if err := w2s.TestRequireNotificationSecret(); err == nil {
		t.Fatal(`blank secret should refuse to start`)
	}

	t.Setenv(`SEND_NOTIFICATION_SECRET_KEY`, `worker-secret`)
	if err := w2s.TestRequireNotificationSecret(); err != nil {
		t.Fatalf(`secret set: %v`, err)
	}
}

func TestStuckConnectionEventsNotify(t *testing.T) {
	t.Parallel()

	for _, evt := range []any{
		&events.TemporaryBan{Code: events.TempBanSentToTooManyPeople, Expire: time.Hour},
		&events.ClientOutdated{},
		&events.ConnectFailure{Reason: events.ConnectFailureServiceUnavailable, Message: `down`},
	} {
		var sends atomic.Int32
		notifier := newNotifier(t, filepath.Join(t.TempDir(), `incident.json`), time.Now(), &sends)
		daemon := w2s.NewTestDaemonBare()
		daemon.AttachNotifier(notifier)
		daemon.HandleEvent(evt)

		if sends.Load() != 1 {
			t.Fatalf(`%T: sends = %d, want 1`, evt, sends.Load())
		}
	}
}

func newNotifier(t *testing.T, path string, now time.Time, sends *atomic.Int32) *w2s.TestNotifier {
	t.Helper()

	notifier := w2s.NewTestNotifier(path)
	notifier.SetNow(now)
	notifier.SetSecret(`worker-secret`)
	notifier.SetPost(func(subject, text string) error {
		if subject != w2s.TestNotifyExitSubject && subject != w2s.TestNotifyDegradedSubject {
			t.Errorf(`subject %q`, subject)
		}
		if strings.TrimSpace(text) == `` {
			t.Error(`empty text`)
		}
		sends.Add(1)
		return nil
	})

	return notifier
}
