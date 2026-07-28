# whatsapp2sqlite

Long-running WhatsApp sync daemon (whatsmeow). Writes into local SQLite, uploads media + DB snapshots to Cloudflare R2, and mirrors named chats into Postgres.

## What it stores

| Destination | Contents |
| --- | --- |
| SQLite (`database_path`) | Session + `sync_chats` / `sync_messages`, plus `groups` / `contacts` / `group_contacts` |
| R2 | Media objects + periodic dirty SQLite snapshot (`r2_database_object_key`) |
| Postgres (`postgres_database_url`) | Named chats → `whatsapp_chats` (startup full sync, then incremental upserts) |

Config: copy `config.jsonc.example` → `config.jsonc`. Relative paths resolve from the config file’s directory.

## Non-blocking design

WhatsApp’s event loop must stay fast. Heavy work is queued:

- **Event persist worker** — serial SQLite writes for messages, history, group/contact events (timeout ~45s; saturated queue drops jobs with a log line).
- **Postgres chat worker** — deduped chat upserts + optional full sync; callers only enqueue. Connect never waits on Postgres.
- **Group metadata sync** — backfill runs after `OfflineSyncCompleted`, not on every connect flicker.
- **Media upload / object delete workers** — R2 I/O off the WA path.

Soft stop drains workers. A hard kill can lose in-memory queues (not yet flushed SQLite/Postgres/R2 jobs).

## Ban safety (do not loosen casually)

Never risk WhatsApp rate limits / bans:

- Prefer **one** `GetJoinedGroups` for group backfill; avoid bulk `GetGroupInfo` / community subgroup fan-out.
- Skip roster rewrite when local membership looks fresh (~24h) and counts are close.
- Extra group IQs are spaced (~10s min) and a **429 → ~30m cooldown**.
- Do not add aggressive polling or per-chat IQ storms.

## Deploy (waltersbox)

```bash
ssh walter@waltersbox
cd ~/whatsapp2sqlite
./deployWhatsapp2Sqlite.sh
```

Deploy clones blissbase via `gh`, builds the binary, and (re)starts the systemd **user** unit `whatsapp2sqlite`.

## Ops

```bash
systemctl --user status whatsapp2sqlite
journalctl --user -u whatsapp2sqlite -f
systemctl --user restart whatsapp2sqlite
```

Useful log prefixes: `backfill groups:`, `postgres chat sync:`, `drop event persist job`.
