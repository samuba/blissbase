package test

import (
	"context"
	"testing"

	w2s "blissbase/whatsapp2sqlite"
)

func TestEnsureSchemaIdempotent(t *testing.T) {
	t.Parallel()

	db := openTestDB(t)
	ctx := context.Background()

	if err := w2s.TestEnsureSchema(ctx, db); err != nil {
		t.Fatalf(`second ensureSchema: %v`, err)
	}

	tables := []string{`sync_chats`, `sync_messages`, `groups`, `contacts`, `group_contacts`}
	for _, table := range tables {
		var name string
		err := db.QueryRow(
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
			table,
		).Scan(&name)
		if err != nil {
			t.Fatalf(`missing table %s: %v`, table, err)
		}
	}

	var leftGroupDefault int
	err := db.QueryRow(
		`SELECT COUNT(*) FROM pragma_table_info('group_contacts') WHERE name = 'left_group'`,
	).Scan(&leftGroupDefault)
	if err != nil || leftGroupDefault != 1 {
		t.Fatalf(`left_group column missing: count=%d err=%v`, leftGroupDefault, err)
	}
}
