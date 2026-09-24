package whatsapp2sqlite

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"
)

const (
	sendNotificationURL       = "https://send-notification.szb.workers.dev"
	sendNotificationSecretEnv = "SEND_NOTIFICATION_SECRET_KEY"
	notifyIncidentFileName    = ".notify-incident.json"
	incidentExit              = "exit"
	incidentDegraded          = "degraded"
	notifyExitSubject         = "whatsapp2sqlite stopped"
	notifyDegradedSubject     = "whatsapp2sqlite error loop"
	// An incident stays open across crash restarts and in-process failures.
	// It ends after this long with no critical failure, so the next failure alerts again.
	notifyIncidentRecovery = 30 * time.Minute
	// While the same incident keeps failing, send at most one more alert after this cooldown.
	notifyIncidentCooldown = 6 * time.Hour
	// A failed delivery retries on this interval instead of on every 5s systemd restart.
	notifySendRetryAfter     = 15 * time.Minute
	notifyStateFlushInterval = time.Minute
	notifyHTTPTimeout        = 10 * time.Second
	notifySubjectMax         = 200
	notifyTextMax            = 100_000
	notifySecretMinLen       = 4
)

var notifyHTTPClient = &http.Client{Timeout: notifyHTTPTimeout}

// criticalNotifier posts incident alerts to the send-notification worker.
// State is stored on disk so a systemd crash loop shares one incident across processes.
type criticalNotifier struct {
	mu                  sync.Mutex
	statePath           string
	secrets             []string
	memory              storedIncidents
	hasMemory           bool
	lastFlush           time.Time
	now                 func() time.Time
	secretFn            func() string
	post                func(subject, text string) error
	blocking            bool
	loggedMissingSecret atomic.Bool
	loggedSuppress      atomic.Bool
}

type incidentState struct {
	Open           bool      `json:"open"`
	FailureCount   int       `json:"failureCount"`
	LastFailureAt  time.Time `json:"lastFailureAt"`
	LastNotifiedAt time.Time `json:"lastNotifiedAt"`
	NextAttemptAt  time.Time `json:"nextAttemptAt"`
}

// storedIncidents keeps exit crashes and in-process failures as separate incidents
// so one class cannot suppress the other, while each class still alerts only once per loop.
type storedIncidents struct {
	Exit     incidentState `json:"exit"`
	Degraded incidentState `json:"degraded"`
}

type sendNotificationPayload struct {
	SecretKey string `json:"secretKey"`
	Subject   string `json:"subject"`
	Text      string `json:"text"`
}

func newCriticalNotifier(statePath string) *criticalNotifier {
	return &criticalNotifier{statePath: statePath}
}

func defaultNotifyStatePath() string {
	cwd, err := os.Getwd()
	if err != nil {
		return notifyIncidentFileName
	}

	return filepath.Join(cwd, notifyIncidentFileName)
}

func (c daemonConfig) notifyStatePath() string {
	if strings.TrimSpace(c.configDirectory) == "" {
		return defaultNotifyStatePath()
	}

	return filepath.Join(c.configDirectory, notifyIncidentFileName)
}

func (n *criticalNotifier) configure(config daemonConfig) {
	if n == nil {
		return
	}

	n.mu.Lock()
	defer n.mu.Unlock()

	n.statePath = config.notifyStatePath()
	n.secrets = secretsFromConfig(config)
}

// requireNotificationSecret refuses to start a daemon that could never alert.
func requireNotificationSecret() error {
	if strings.TrimSpace(os.Getenv(sendNotificationSecretEnv)) != "" {
		return nil
	}

	return fmt.Errorf("missing %s: set it in notify.env next to the binary", sendNotificationSecretEnv)
}

// report sends at most one alert per open incident of this kind.
// blocking waits for the HTTP call so a process that is about to exit still delivers.
func (n *criticalNotifier) report(err error, kind string, blocking bool) {
	if n == nil || err == nil {
		return
	}

	if !n.ensureSecret() {
		return
	}

	subject, text, ok := n.claimSend(kind, err)
	if !ok {
		if n.loggedSuppress.CompareAndSwap(false, true) {
			log.Printf("notification: suppressed repeat until the process stays healthy for %s or %s elapses", notifyIncidentRecovery, notifyIncidentCooldown)
		}
		return
	}

	n.loggedSuppress.Store(false)
	deliver := func() {
		if sendErr := n.deliver(subject, text); sendErr != nil {
			log.Printf("notification: send failed: %v", sendErr)
			return
		}

		n.markDelivered(kind)
		log.Printf("notification: sent incident alert")
	}

	if blocking {
		deliver()
		return
	}

	go deliver()
}

func (n *criticalNotifier) ensureSecret() bool {
	if strings.TrimSpace(n.secret()) != "" {
		return true
	}

	if n.loggedMissingSecret.CompareAndSwap(false, true) {
		log.Printf("notification: %s is unset, skipping send", sendNotificationSecretEnv)
	}

	return false
}

func (n *criticalNotifier) claimSend(kind string, err error) (string, string, bool) {
	n.mu.Lock()
	defer n.mu.Unlock()

	now := n.currentTimeLocked()
	file := n.loadLocked()
	next, send := decideNotification(file.get(kind), now)
	file.set(kind, next)
	n.saveLocked(file, now, send)
	if !send {
		return "", "", false
	}

	return notificationSubject(kind), n.textLocked(err, next.FailureCount), true
}

func (n *criticalNotifier) markDelivered(kind string) {
	n.mu.Lock()
	defer n.mu.Unlock()

	now := n.currentTimeLocked()
	file := n.loadLocked()
	state := file.get(kind)
	state.Open = true
	if state.LastFailureAt.IsZero() {
		state.LastFailureAt = now
	}
	state.LastNotifiedAt = now
	state.NextAttemptAt = time.Time{}
	file.set(kind, state)
	n.saveLocked(file, now, true)
}

func (n *criticalNotifier) loadLocked() storedIncidents {
	if n.hasMemory {
		return n.memory
	}

	state, err := readIncidentState(n.statePath)
	if err != nil {
		log.Printf("notification: read incident state failed: %v", err)
		return storedIncidents{}
	}

	return state
}

func (n *criticalNotifier) saveLocked(state storedIncidents, now time.Time, force bool) {
	n.memory = state
	n.hasMemory = true
	if !force && !n.lastFlush.IsZero() && now.Sub(n.lastFlush) < notifyStateFlushInterval {
		return
	}

	n.lastFlush = now
	if err := writeIncidentState(n.statePath, state); err != nil {
		log.Printf("notification: save incident state failed: %v", err)
	}
}

func (n *criticalNotifier) currentTimeLocked() time.Time {
	if n.now != nil {
		return n.now()
	}

	return time.Now()
}

func (n *criticalNotifier) secret() string {
	if n != nil && n.secretFn != nil {
		return strings.TrimSpace(n.secretFn())
	}

	return strings.TrimSpace(os.Getenv(sendNotificationSecretEnv))
}

func (n *criticalNotifier) textLocked(err error, failures int) string {
	detail := strings.TrimSpace(err.Error())
	if detail == "" {
		detail = "unknown error"
	}

	if failures < 1 {
		failures = 1
	}

	text := fmt.Sprintf("whatsapp2sqlite on %s hit a critical error (%d in this incident):\n\n%s\n\nRepeats are suppressed until the process stays healthy for %s, or until %s pass while it keeps failing.", machineHost(), failures, detail, notifyIncidentRecovery, notifyIncidentCooldown)
	secrets := append([]string{}, n.secrets...)
	if secret := n.secret(); secret != "" {
		secrets = append(secrets, secret)
	}

	return redactSecrets(text, secrets)
}

func (n *criticalNotifier) deliver(subject, text string) error {
	if n.post != nil {
		return n.post(subject, text)
	}

	ctx, cancel := context.WithTimeout(context.Background(), notifyHTTPTimeout)
	defer cancel()

	return postSendNotification(ctx, sendNotificationURL, n.secret(), subject, text)
}

// decideNotification starts an incident, continues one, or lets a long cooldown elapse.
// A new incident is any critical failure after notifyIncidentRecovery without one.
func decideNotification(prev incidentState, now time.Time) (incidentState, bool) {
	next := prev
	next.Open = true
	next.LastFailureAt = now
	if stillInIncident(prev, now) {
		next.FailureCount = prev.FailureCount + 1
		if next.FailureCount < 1 {
			next.FailureCount = 1
		}
	} else {
		next.FailureCount = 1
		next.LastNotifiedAt = time.Time{}
		next.NextAttemptAt = now.Add(notifySendRetryAfter)
		return next, true
	}

	if !prev.LastNotifiedAt.IsZero() && now.Sub(prev.LastNotifiedAt) < notifyIncidentCooldown {
		return next, false
	}

	if !prev.NextAttemptAt.IsZero() && now.Before(prev.NextAttemptAt) {
		return next, false
	}

	next.NextAttemptAt = now.Add(notifySendRetryAfter)
	return next, true
}

func stillInIncident(prev incidentState, now time.Time) bool {
	if !prev.Open || prev.LastFailureAt.IsZero() {
		return false
	}

	if prev.LastFailureAt.After(now) {
		return true
	}

	return now.Sub(prev.LastFailureAt) < notifyIncidentRecovery
}

func shouldReportProcessError(err error) bool {
	if err == nil {
		return false
	}

	return !errors.Is(err, context.Canceled)
}

func postSendNotification(ctx context.Context, endpoint, secret, subject, text string) error {
	secret = strings.TrimSpace(secret)
	subject = strings.TrimSpace(subject)
	text = strings.TrimSpace(text)
	if secret == "" {
		return errors.New("missing notification secret")
	}
	if subject == "" {
		subject = notifyDegradedSubject
	}
	if text == "" {
		text = "unknown error"
	}

	subject = trimMax(subject, notifySubjectMax)
	text = trimMax(text, notifyTextMax)

	payload, err := json.Marshal(sendNotificationPayload{
		SecretKey: secret,
		Subject:   subject,
		Text:      text,
	})
	if err != nil {
		return fmt.Errorf("encode notification: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("build notification request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := notifyHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("post notification: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("send-notification status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var parsed struct {
		OK bool `json:"ok"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil || !parsed.OK {
		return fmt.Errorf("send-notification rejected the payload: %s", strings.TrimSpace(string(body)))
	}

	return nil
}

func secretsFromConfig(config daemonConfig) []string {
	secrets := []string{
		strings.TrimSpace(config.PostgresDatabaseURL),
		strings.TrimSpace(config.R2SecretAccessKey),
		strings.TrimSpace(config.R2AccessKeyID),
	}

	parsed, err := url.Parse(config.PostgresDatabaseURL)
	if err == nil && parsed.User != nil {
		if password, ok := parsed.User.Password(); ok {
			secrets = append(secrets, password)
		}
	}

	return secrets
}

func redactSecrets(text string, secrets []string) string {
	filtered := make([]string, 0, len(secrets))
	seen := map[string]struct{}{}
	for _, secret := range secrets {
		secret = strings.TrimSpace(secret)
		if len(secret) < notifySecretMinLen {
			continue
		}
		if _, ok := seen[secret]; ok {
			continue
		}

		seen[secret] = struct{}{}
		filtered = append(filtered, secret)
	}

	sort.Slice(filtered, func(i, j int) bool {
		return len(filtered[i]) > len(filtered[j])
	})

	for _, secret := range filtered {
		text = strings.ReplaceAll(text, secret, "[redacted]")
	}

	return text
}

func trimMax(value string, max int) string {
	if max <= 0 || value == "" {
		return ""
	}
	if len(value) <= max {
		return value
	}

	cut := value[:max]
	for cut != "" && !utf8.ValidString(cut) {
		cut = cut[:len(cut)-1]
	}

	return cut
}

func machineHost() string {
	host, err := os.Hostname()
	host = strings.TrimSpace(host)
	if err != nil || host == "" {
		return "unknown-host"
	}

	return host
}

func notificationSubject(kind string) string {
	if kind == incidentExit {
		return notifyExitSubject
	}

	return notifyDegradedSubject
}

func (file storedIncidents) get(kind string) incidentState {
	if kind == incidentExit {
		return file.Exit
	}

	return file.Degraded
}

func (file *storedIncidents) set(kind string, state incidentState) {
	if kind == incidentExit {
		file.Exit = state
		return
	}

	file.Degraded = state
}

func readIncidentState(path string) (storedIncidents, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return storedIncidents{}, nil
	}
	if err != nil {
		return storedIncidents{}, err
	}

	var state storedIncidents
	if err := json.Unmarshal(data, &state); err != nil {
		return storedIncidents{}, fmt.Errorf("parse incident state: %w", err)
	}

	return state, nil
}

func writeIncidentState(path string, state storedIncidents) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create notification state dir: %w", err)
	}

	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')

	tmp, err := os.CreateTemp(dir, ".notify-incident-*.tmp")
	if err != nil {
		return err
	}

	tmpName := tmp.Name()
	cleanup := true
	defer func() {
		if cleanup {
			os.Remove(tmpName)
		}
	}()

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpName, path); err != nil {
		return err
	}

	cleanup = false
	return nil
}
