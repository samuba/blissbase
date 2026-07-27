package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// newPostgresChatsSync opens a Postgres pool used to mirror named chats into `whatsapp_chats`.
// Example: `syncer, err := newPostgresChatsSync(ctx, config.PostgresDatabaseURL)`
func newPostgresChatsSync(ctx context.Context, databaseURL string) (*postgresChatsSync, error) {
	databaseURL = strings.TrimSpace(databaseURL)
	if databaseURL == "" {
		return nil, fmt.Errorf("missing `postgres_database_url` in config")
	}

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("connect postgres database: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres database: %w", err)
	}

	return &postgresChatsSync{pool: pool}, nil
}

// Close releases the Postgres connection pool.
// Example: `defer syncer.Close()`
func (s *postgresChatsSync) Close() {
	if s == nil || s.pool == nil {
		return
	}

	s.pool.Close()
}

// syncAllNamedChats upserts every SQLite chat that has a non-empty name into Postgres.
// Example: `if err := d.syncAllNamedChats(ctx); err != nil { return err }`
func (d *daemon) syncAllNamedChats(ctx context.Context) error {
	if d == nil || d.db == nil || d.postgres == nil {
		return nil
	}

	rows, err := d.db.QueryContext(ctx, `
		SELECT
			chat_jid,
			TRIM(COALESCE(NULLIF(TRIM(display_name), ''), NULLIF(TRIM(username), ''))) AS name,
			last_message_timestamp
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

	if err := d.postgres.flushBatch(ctx, batch); err != nil {
		return fmt.Errorf("initial postgres chat sync failed: %w", err)
	}

	log.Printf("postgres chat sync: upserted %d named chats", count)
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
			last_message_timestamp
		FROM sync_chats
		WHERE chat_jid = ?
	`, chatJID)

	chat, err := scanNamedSyncChat(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return
		}
		log.Printf("postgres chat sync: read %s failed: %v", chatJID, err)
		return
	}

	if chat.name == "" {
		return
	}

	batch := &pgx.Batch{}
	queueWhatsappChatUpsert(batch, chat)
	if err := d.postgres.flushBatch(ctx, batch); err != nil {
		log.Printf("postgres chat sync: upsert %s failed: %v", chatJID, err)
	}
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
	if s == nil || s.pool == nil || batch == nil || batch.Len() == 0 {
		return nil
	}

	results := s.pool.SendBatch(ctx, batch)
	defer results.Close()

	for range batch.Len() {
		if _, err := results.Exec(); err != nil {
			return err
		}
	}

	return nil
}

func queueWhatsappChatUpsert(batch *pgx.Batch, chat namedSyncChat) {
	batch.Queue(`
		INSERT INTO whatsapp_chats (
			chat_jid,
			name,
			last_message_time,
			updated_at
		) VALUES ($1, $2, $3, NOW())
		ON CONFLICT (chat_jid) DO UPDATE SET
			name = EXCLUDED.name,
			last_message_time = COALESCE(EXCLUDED.last_message_time, whatsapp_chats.last_message_time),
			updated_at = NOW()
	`, chat.chatJID, chat.name, chat.lastMessageTime)
}

func scanNamedSyncChat(row interface {
	Scan(dest ...any) error
}) (namedSyncChat, error) {
	var chat namedSyncChat
	var name sql.NullString
	var lastMessageTimestamp sql.NullInt64

	if err := row.Scan(&chat.chatJID, &name, &lastMessageTimestamp); err != nil {
		return namedSyncChat{}, err
	}

	if name.Valid {
		chat.name = strings.TrimSpace(name.String)
	}

	if lastMessageTimestamp.Valid && lastMessageTimestamp.Int64 > 0 {
		timestamp := time.Unix(lastMessageTimestamp.Int64, 0).UTC()
		chat.lastMessageTime = &timestamp
	}

	return chat, nil
}

type postgresChatsSync struct {
	pool *pgxpool.Pool
}

type namedSyncChat struct {
	chatJID         string
	name            string
	lastMessageTime *time.Time
}
