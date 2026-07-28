package test

import (
	"os"
	"path/filepath"
	"testing"

	w2s "blissbase/whatsapp2sqlite"
)

func TestLoadConfigJSONCAndDefaults(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, `config.jsonc`)
	content := `{
  // comment
  "database_path": "./data/wa.sqlite",
  "postgres_database_url": "postgres://localhost/test",
  "r2_bucket": "bucket",
  "r2_access_key_id": "key",
  "r2_secret_access_key": "secret",
  "r2_account_id": "acct123"
}`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf(`write config: %v`, err)
	}

	config, err := w2s.TestLoadConfig(path)
	if err != nil {
		t.Fatalf(`loadConfig: %v`, err)
	}

	if config.DatabasePath != `./data/wa.sqlite` {
		t.Fatalf(`DatabasePath: %q`, config.DatabasePath)
	}
	if config.PushName != `Blissbase Sync` {
		t.Fatalf(`PushName default: %q`, config.PushName)
	}
	if config.R2DatabaseObjectKey != w2s.TestDefaultR2DatabaseObjectKey {
		t.Fatalf(`R2DatabaseObjectKey: %q`, config.R2DatabaseObjectKey)
	}
	if config.R2MediaPrefix != w2s.TestDefaultR2MediaPrefix {
		t.Fatalf(`R2MediaPrefix: %q`, config.R2MediaPrefix)
	}
	if config.ExposedR2Endpoint() != `https://acct123.r2.cloudflarestorage.com` {
		t.Fatalf(`endpoint: %q`, config.ExposedR2Endpoint())
	}
	if err := config.Validate(); err != nil {
		t.Fatalf(`validate: %v`, err)
	}

	resolved, err := config.ResolvePath(config.DatabasePath)
	if err != nil {
		t.Fatalf(`resolvePath: %v`, err)
	}
	want := filepath.Join(dir, `data`, `wa.sqlite`)
	if filepath.Clean(resolved) != filepath.Clean(want) {
		t.Fatalf(`resolvePath = %q, want %q`, resolved, want)
	}
}

func TestConfigValidateMissingFields(t *testing.T) {
	t.Parallel()

	config := w2s.Config{}
	if err := config.Validate(); err == nil {
		t.Fatal(`expected validation error`)
	}

	config = w2s.Config{
		DatabasePath:         `./db.sqlite`,
		PostgresDatabaseURL:  `postgres://x`,
		R2Bucket:             `b`,
		R2AccessKeyID:        `k`,
		R2SecretAccessKey:    `s`,
		R2DatabaseObjectKey:  `whatsapp.sqlite`,
		R2AccountID:          `acct`,
		DatabaseSyncInterval: `0s`,
	}
	if err := config.Validate(); err == nil {
		t.Fatal(`expected invalid sync interval error`)
	}
}
