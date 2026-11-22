package whatsapp2sqlite

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

func TestSnapshotSyncBudgetCoversRetries(t *testing.T) {
	if databaseSyncTimeout != 5*time.Minute {
		t.Fatalf("databaseSyncTimeout = %s, want 5m", databaseSyncTimeout)
	}
	if mediaUploadTimeout != 2*time.Minute {
		t.Fatalf("mediaUploadTimeout = %s, want 2m", mediaUploadTimeout)
	}
	if snapshotUploadAttemptTimeout < 60*time.Second || snapshotUploadAttemptTimeout > 90*time.Second {
		t.Fatalf("snapshotUploadAttemptTimeout = %s, want 60s–90s", snapshotUploadAttemptTimeout)
	}
	if snapshotUploadAttempts != 4 {
		t.Fatalf("snapshotUploadAttempts = %d, want 4", snapshotUploadAttempts)
	}
	if databaseSyncTimeout <= mediaUploadTimeout {
		t.Fatal("snapshot sync budget must stay larger than the media upload timeout")
	}

	transport, ok := snapshotUploadHTTPClient.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("transport type %T", snapshotUploadHTTPClient.Transport)
	}
	if transport.ResponseHeaderTimeout != snapshotUploadAttemptTimeout {
		t.Fatalf("response header timeout = %s", transport.ResponseHeaderTimeout)
	}
}

func TestUploadDatabaseSnapshotRetriesThenSucceeds(t *testing.T) {
	restoreRetryUnit(t, time.Nanosecond)
	logs := captureWarnLogs(t)

	payload := []byte("sqlite-bytes")
	store := &scriptedR2{failures: 2}
	var alerts int
	manager := &r2Manager{
		bucket:            "bucket",
		client:            store,
		databaseObjectKey: "whatsapp.sqlite",
		onCritical: func(error) {
			alerts++
		},
	}

	err := manager.uploadDatabaseSnapshot(context.Background(), snapshotFile(t, payload), int64(len(payload)))
	if err != nil {
		t.Fatal(err)
	}
	if store.puts != 3 {
		t.Fatalf("puts = %d, want 3", store.puts)
	}
	if alerts != 0 {
		t.Fatalf("alerts = %d, want 0", alerts)
	}
	for i, body := range store.bodies {
		if !bytes.Equal(body, payload) {
			t.Fatalf("attempt %d sent %q", i+1, body)
		}
	}
	if bytes.Count(logs.Bytes(), []byte("level=WARN")) != 2 {
		t.Fatalf("logs:\n%s", logs.String())
	}
}

func TestUploadDatabaseSnapshotAlertsOnlyAfterRetriesFail(t *testing.T) {
	restoreRetryUnit(t, time.Nanosecond)
	logs := captureWarnLogs(t)

	payload := []byte("sqlite-bytes")
	store := &scriptedR2{failures: snapshotUploadAttempts + 2}
	var alerts int
	manager := &r2Manager{
		bucket:            "bucket",
		client:            store,
		databaseObjectKey: "whatsapp.sqlite",
		onCritical: func(error) {
			alerts++
		},
	}

	err := manager.uploadDatabaseSnapshot(context.Background(), snapshotFile(t, payload), int64(len(payload)))
	if err == nil {
		t.Fatal("expected upload error")
	}
	if store.puts != snapshotUploadAttempts {
		t.Fatalf("puts = %d, want %d", store.puts, snapshotUploadAttempts)
	}
	if alerts != 0 {
		t.Fatalf("retry loop alerted %d times", alerts)
	}
	if bytes.Count(logs.Bytes(), []byte("level=WARN")) != snapshotUploadAttempts-1 {
		t.Fatalf("logs:\n%s", logs.String())
	}

	manager.onCritical(err)
	if alerts != 1 {
		t.Fatalf("alerts = %d, want 1 after the sync reports the final error", alerts)
	}
}

func TestUploadDatabaseSnapshotStopsWhenContextCanceled(t *testing.T) {
	restoreRetryUnit(t, time.Hour)

	ctx, cancel := context.WithCancel(context.Background())
	payload := []byte("sqlite-bytes")
	store := &scriptedR2{failures: snapshotUploadAttempts, afterPut: cancel}
	manager := &r2Manager{
		bucket:            "bucket",
		client:            store,
		databaseObjectKey: "whatsapp.sqlite",
	}

	done := make(chan error, 1)
	go func() {
		done <- manager.uploadDatabaseSnapshot(ctx, snapshotFile(t, payload), int64(len(payload)))
	}()

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected upload error")
		}
		if store.puts != 1 {
			t.Fatalf("puts = %d, want 1", store.puts)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("retry backoff ignored context cancel")
	}
}

func TestStallConnWriteTimesOut(t *testing.T) {
	left, right := net.Pipe()
	t.Cleanup(func() {
		left.Close()
		right.Close()
	})

	conn := stallConn{Conn: left, idle: 50 * time.Millisecond}
	start := time.Now()
	_, err := conn.Write(bytes.Repeat([]byte("x"), 1<<20))
	if err == nil {
		t.Fatal("expected stall timeout")
	}
	if time.Since(start) > time.Second {
		t.Fatalf("stall took %s", time.Since(start))
	}
}

func TestStallConnAllowsProgressingWrites(t *testing.T) {
	left, right := net.Pipe()
	t.Cleanup(func() {
		left.Close()
		right.Close()
	})

	idle := 80 * time.Millisecond
	done := make(chan struct{})
	go func() {
		defer close(done)
		buf := make([]byte, 1)
		for {
			if _, err := right.Read(buf); err != nil {
				return
			}
		}
	}()

	conn := stallConn{Conn: left, idle: idle}
	start := time.Now()
	for range 20 {
		if _, err := conn.Write([]byte("x")); err != nil {
			t.Fatal(err)
		}
		time.Sleep(10 * time.Millisecond)
	}
	left.Close()
	<-done
	if time.Since(start) < idle {
		t.Fatalf("elapsed %s, want longer than stall timeout %s", time.Since(start), idle)
	}
}

func TestSnapshotHTTPClientFailsStalledUpload(t *testing.T) {
	const idle = 150 * time.Millisecond

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })

	accepted := make(chan struct{})
	hold := make(chan struct{})
	t.Cleanup(func() { close(hold) })
	go func() {
		conn, acceptErr := ln.Accept()
		if acceptErr != nil {
			return
		}
		defer conn.Close()
		close(accepted)
		<-hold
	}()

	client := newSnapshotUploadHTTPClient(idle)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, "http://"+ln.Addr().String()+"/snap", bytes.NewReader(bytes.Repeat([]byte("a"), 8<<20)))
	if err != nil {
		t.Fatal(err)
	}
	req.ContentLength = 8 << 20

	start := time.Now()
	_, err = client.Do(req)
	elapsed := time.Since(start)
	if err == nil {
		t.Fatal("expected stalled upload to fail")
	}
	if elapsed > 2*time.Second {
		t.Fatalf("stalled upload took %s", elapsed)
	}
	select {
	case <-accepted:
	default:
		t.Fatal("server did not accept")
	}
}

func restoreRetryUnit(t *testing.T, unit time.Duration) {
	t.Helper()
	prev := snapshotUploadRetryUnit
	snapshotUploadRetryUnit = unit
	t.Cleanup(func() { snapshotUploadRetryUnit = prev })
}

func captureWarnLogs(t *testing.T) *bytes.Buffer {
	t.Helper()
	var logs bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelWarn})))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return &logs
}

func snapshotFile(t *testing.T, payload []byte) *os.File {
	t.Helper()
	path := filepath.Join(t.TempDir(), "whatsapp.sqlite")
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = file.Close() })
	return file
}

type scriptedR2 struct {
	failures int
	puts     int
	bodies   [][]byte
	afterPut func()
}

func (s *scriptedR2) PutObject(ctx context.Context, params *s3.PutObjectInput, optFns ...func(*s3.Options)) (*s3.PutObjectOutput, error) {
	options := &s3.Options{}
	for _, fn := range optFns {
		fn(options)
	}
	if options.HTTPClient != snapshotUploadHTTPClient {
		return nil, errors.New("snapshot put did not use the snapshot HTTP client")
	}
	if options.Retryer == nil || options.Retryer.MaxAttempts() != 1 {
		return nil, errors.New("snapshot put must fail a stall once so the outer loop can retry it")
	}
	if aws.ToString(params.Key) != "whatsapp.sqlite" {
		return nil, fmt.Errorf("key %q", aws.ToString(params.Key))
	}

	body, err := io.ReadAll(params.Body)
	if err != nil {
		return nil, err
	}
	s.puts++
	s.bodies = append(s.bodies, body)
	if s.afterPut != nil {
		s.afterPut()
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if s.puts <= s.failures {
		return nil, errors.New("StatusCode: 0, canceled, context deadline exceeded")
	}
	return &s3.PutObjectOutput{}, nil
}

func (s *scriptedR2) DeleteObject(context.Context, *s3.DeleteObjectInput, ...func(*s3.Options)) (*s3.DeleteObjectOutput, error) {
	return &s3.DeleteObjectOutput{}, nil
}
