package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	postgresMaxFlushAttempts  = 5
	postgresHealthCheckPeriod = time.Minute
	postgresMaxConnLifetime   = time.Hour
	postgresMaxConnIdleTime   = 15 * time.Minute
)

// newPostgresChatsSync opens a Postgres pool used to mirror named chats into `whatsapp_chats`.
// Example: `syncer, err := newPostgresChatsSync(ctx, config.PostgresDatabaseURL)`
func newPostgresChatsSync(ctx context.Context, databaseURL string) (*postgresChatsSync, error) {
	databaseURL = strings.TrimSpace(databaseURL)
	if databaseURL == "" {
		return nil, fmt.Errorf("missing `postgres_database_url` in config")
	}

	syncer := &postgresChatsSync{databaseURL: databaseURL}
	if err := syncer.recreatePool(ctx); err != nil {
		return nil, err
	}

	if err := syncer.getPool().Ping(ctx); err != nil {
		syncer.Close()
		return nil, fmt.Errorf("ping postgres database: %w", err)
	}

	log.Printf("postgres chat sync: connected")
	return syncer, nil
}

// Close releases the Postgres connection pool.
// Example: `defer syncer.Close()`
func (s *postgresChatsSync) Close() {
	if s == nil {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if s.pool == nil {
		return
	}

	s.pool.Close()
	s.pool = nil
	log.Printf("postgres chat sync: connection closed")
}

// syncAllNamedChats upserts every SQLite chat that has a non-empty name into Postgres.
// Example: `if err := d.syncAllNamedChats(ctx); err != nil { return err }`
func (d *daemon) syncAllNamedChats(ctx context.Context) error {
	if d == nil || d.db == nil || d.postgres == nil {
		return nil
	}

	log.Printf("postgres chat sync: starting full sync of named chats")
	startedAt := time.Now()

	rows, err := d.db.QueryContext(ctx, `
		SELECT
			chat_jid,
			TRIM(COALESCE(NULLIF(TRIM(display_name), ''), NULLIF(TRIM(username), ''))) AS name,
			last_message_timestamp,
			updated_at
		FROM sync_chats
		WHERE TRIM(COALESCE(NULLIF(TRIM(display_name), ''), NULLIF(TRIM(username), ''))) != ''
	`)
	if err != nil {
		return fmt.Errorf("query named sync chats: %w", err)
	}
	defer rows.Close()

	batch := &pgx.Batch{}
	count := 0

	for rows.Next() {
		chat, err := scanNamedSyncChat(rows)
		if err != nil {
			return err
		}

		queueWhatsappChatUpsert(batch, chat)
		count++
	}

	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate named sync chats: %w", err)
	}

	if count == 0 {
		log.Printf("postgres chat sync: no named chats to upsert")
		return nil
	}

	log.Printf("postgres chat sync: upserting %d named chats", count)
	if err := d.postgres.flushBatch(ctx, batch); err != nil {
		log.Printf("postgres chat sync: full sync failed after %s: %v", time.Since(startedAt).Round(time.Millisecond), err)
		return fmt.Errorf("initial postgres chat sync failed: %w", err)
	}

	log.Printf("postgres chat sync: upserted %d named chats in %s", count, time.Since(startedAt).Round(time.Millisecond))
	return nil
}

// syncChatToPostgres mirrors one SQLite chat into Postgres when it has a non-empty name.
// Example: `d.syncChatToPostgres(ctx, chatJID)`
func (d *daemon) syncChatToPostgres(ctx context.Context, chatJID string) {
	if d == nil || d.db == nil || d.postgres == nil {
		return
	}

	chatJID = strings.TrimSpace(chatJID)
	if chatJID == "" {
		return
	}

	row := d.db.QueryRowContext(ctx, `
		SELECT
			chat_jid,
			TRIM(COALESCE(NULLIF(TRIM(display_name), ''), NULLIF(TRIM(username), ''))) AS name,
			last_message_timestamp,
			updated_at
		FROM sync_chats
		WHERE chat_jid = ?
	`, chatJID)

	chat, err := scanNamedSyncChat(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			log.Printf("postgres chat sync: skip %s (not found in sqlite)", chatJID)
			return
		}
		log.Printf("postgres chat sync: read %s failed: %v", chatJID, err)
		return
	}

	if chat.name == "" {
		log.Printf("postgres chat sync: skip %s (empty name)", chatJID)
		return
	}

	startedAt := time.Now()
	log.Printf("postgres chat sync: upserting %s (%s)", chat.chatJID, chat.name)

	batch := &pgx.Batch{}
	queueWhatsappChatUpsert(batch, chat)
	if err := d.postgres.flushBatch(ctx, batch); err != nil {
		log.Printf("postgres chat sync: upsert %s (%s) failed after %s: %v", chat.chatJID, chat.name, time.Since(startedAt).Round(time.Millisecond), err)
		return
	}

	log.Printf("postgres chat sync: upserted %s (%s) in %s", chat.chatJID, chat.name, time.Since(startedAt).Round(time.Millisecond))
}

// touchSyncChatLastMessage updates the chat's last message timestamp in SQLite without clearing the name.
// Example: `if err := d.touchSyncChatLastMessage(ctx, chatJID, ts); err != nil { return err }`
func (d *daemon) touchSyncChatLastMessage(ctx context.Context, chatJID string, messageTimestamp int64) error {
	if d == nil || d.db == nil {
		return nil
	}

	chatJID = strings.TrimSpace(chatJID)
	if chatJID == "" || messageTimestamp <= 0 {
		return nil
	}

	now := time.Now().Unix()
	_, err := d.db.ExecContext(
		ctx,
		`INSERT INTO sync_chats (
			chat_jid,
			last_message_timestamp,
			updated_at
		) VALUES (?, ?, ?)
		ON CONFLICT(chat_jid) DO UPDATE SET
			last_message_timestamp = CASE
				WHEN sync_chats.last_message_timestamp IS NULL THEN excluded.last_message_timestamp
				WHEN excluded.last_message_timestamp > sync_chats.last_message_timestamp THEN excluded.last_message_timestamp
				ELSE sync_chats.last_message_timestamp
			END,
			updated_at = excluded.updated_at`,
		chatJID,
		messageTimestamp,
		now,
	)
	if err != nil {
		return fmt.Errorf("touch sync chat last message for %s: %w", chatJID, err)
	}

	return nil
}

func (s *postgresChatsSync) flushBatch(ctx context.Context, batch *pgx.Batch) error {
	if s == nil || batch == nil || batch.Len() == 0 {
		return nil
	}

	batchLen := batch.Len()
	var lastErr error
	for attempt := 1; attempt <= postgresMaxFlushAttempts; attempt++ {
		err := s.sendBatchOnce(ctx, batch)
		if err == nil {
			if attempt > 1 {
				log.Printf("postgres chat sync: flushed %d statements after %d attempts", batchLen, attempt)
			}
			return nil
		}

		lastErr = err
		if !isTransientPostgresError(err) || attempt == postgresMaxFlushAttempts {
			log.Printf("postgres chat sync: flush of %d statements failed on attempt %d/%d: %v", batchLen, attempt, postgresMaxFlushAttempts, err)
			return err
		}

		backoff := time.Duration(attempt*attempt) * 200 * time.Millisecond
		log.Printf("postgres chat sync: transient error on attempt %d/%d for %d statements, retrying in %s: %v", attempt, postgresMaxFlushAttempts, batchLen, backoff, err)

		if recreateErr := s.recreatePool(ctx); recreateErr != nil {
			log.Printf("postgres chat sync: recreate pool failed: %v", recreateErr)
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}
	}

	return lastErr
}

func (s *postgresChatsSync) sendBatchOnce(ctx context.Context, batch *pgx.Batch) error {
	pool := s.getPool()
	if pool == nil {
		if err := s.recreatePool(ctx); err != nil {
			return err
		}
		pool = s.getPool()
	}
	if pool == nil {
		return errors.New("postgres pool is closed")
	}

	results := pool.SendBatch(ctx, batch)
	defer results.Close()

	for range batch.Len() {
		if _, err := results.Exec(); err != nil {
			return err
		}
	}

	return nil
}

func (s *postgresChatsSync) recreatePool(ctx context.Context) error {
	if s == nil {
		return errors.New("postgres syncer is nil")
	}

	poolConfig, err := pgxpool.ParseConfig(s.databaseURL)
	if err != nil {
		return fmt.Errorf("parse postgres database url: %w", err)
	}

	poolConfig.MaxConns = 4
	poolConfig.MinConns = 0
	poolConfig.MaxConnLifetime = postgresMaxConnLifetime
	poolConfig.MaxConnIdleTime = postgresMaxConnIdleTime
	poolConfig.HealthCheckPeriod = postgresHealthCheckPeriod

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return fmt.Errorf("reconnect postgres database: %w", err)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	replacedExisting := s.pool != nil
	if s.pool != nil {
		s.pool.Close()
	}
	s.pool = pool

	if replacedExisting {
		log.Printf("postgres chat sync: recreated connection pool")
	}
	return nil
}

func (s *postgresChatsSync) getPool() *pgxpool.Pool {
	if s == nil {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	return s.pool
}

func isTransientPostgresError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) {
		return false
	}
	if pgconn.SafeToRetry(err) {
		return true
	}

	var netErr net.Error
	if errors.As(err, &netErr) {
		return true
	}

	var connectErr *pgconn.ConnectError
	if errors.As(err, &connectErr) {
		return true
	}

	msg := strings.ToLower(err.Error())
	transientNeedles := []string{
		"connection reset",
		"broken pipe",
		"connection refused",
		"unexpected eof",
		"server closed the connection",
		"conn closed",
		"connection closed",
		"i/o timeout",
		"no connection",
		"dial tcp",
		"driver: bad connection",
		"sql: database is closed",
		"connect: connection timed out",
	}
	for _, needle := range transientNeedles {
		if strings.Contains(msg, needle) {
			return true
		}
	}

	return false
}

func queueWhatsappChatUpsert(batch *pgx.Batch, chat namedSyncChat) {
	batch.Queue(`
		INSERT INTO whatsapp_chats (
			chat_jid,
			name,
			last_message_time,
			updated_at
		) VALUES ($1, $2, $3, $4)
		ON CONFLICT (chat_jid) DO UPDATE SET
			name = EXCLUDED.name,
			last_message_time = CASE
				WHEN EXCLUDED.last_message_time IS NULL THEN whatsapp_chats.last_message_time
				WHEN whatsapp_chats.last_message_time IS NULL THEN EXCLUDED.last_message_time
				WHEN EXCLUDED.last_message_time > whatsapp_chats.last_message_time THEN EXCLUDED.last_message_time
				ELSE whatsapp_chats.last_message_time
			END,
			updated_at = EXCLUDED.updated_at
	`, chat.chatJID, chat.name, chat.lastMessageTime, chat.updatedAt)
}

func scanNamedSyncChat(row interface {
	Scan(dest ...any) error
}) (namedSyncChat, error) {
	var chat namedSyncChat
	var name sql.NullString
	var lastMessageTimestamp sql.NullInt64
	var updatedAt int64

	if err := row.Scan(&chat.chatJID, &name, &lastMessageTimestamp, &updatedAt); err != nil {
		return namedSyncChat{}, err
	}

	if name.Valid {
		chat.name = strings.TrimSpace(name.String)
	}

	if lastMessageTimestamp.Valid && lastMessageTimestamp.Int64 > 0 {
		timestamp := time.Unix(lastMessageTimestamp.Int64, 0).UTC()
		chat.lastMessageTime = &timestamp
	}

	if updatedAt > 0 {
		chat.updatedAt = time.Unix(updatedAt, 0).UTC()
	} else {
		chat.updatedAt = time.Now().UTC()
	}

	return chat, nil
}

type postgresChatsSync struct {
	databaseURL string
	mu          sync.Mutex
	pool        *pgxpool.Pool
}

type namedSyncChat struct {
	chatJID         string
	name            string
	lastMessageTime *time.Time
	updatedAt       time.Time
}
