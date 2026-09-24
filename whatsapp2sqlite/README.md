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

Useful log prefixes: `backfill groups:`, `postgres chat sync:`, `drop event persist job`, `event persist`, `sqlite snapshot:`, `notification:`.

## Alerts

Critical failures POST to the [send-notification](https://github.com/samuba/send-notification) worker (`POST https://send-notification.szb.workers.dev` with `secretKey`, `subject`, and `text`). The worker chooses delivery. This daemon does not talk to Telegram itself.

Set `SEND_NOTIFICATION_SECRET_KEY` in `notify.env` next to the binary (see `notify.env.example`, `chmod 600` it). The systemd unit loads that file. The value must match the worker secret `SECRET_KEY`. The daemon refuses to start without it.

What alerts:

- Any error that makes the process exit (config, startup, connect, logout, stream replaced, QR pairing failure). systemd restarts those, so they are the crash loop.
- In-process failures: event persist errors, a saturated persist queue, Postgres chat sync failures, SQLite snapshot sync failures, WhatsApp keepalive loss (3 or more failures), and connection states whatsmeow does not recover from on its own (temporary ban, outdated client, connect failure without auto reconnect).

Throttle: one alert per incident. Exit crashes and in-process failures are separate incidents, so one cannot hide the other. An incident stays open while failures keep coming. It ends after 30 minutes with no failure of that kind; the next failure alerts again. If the loop never stops, the same incident alerts again only after 6 hours. A failed delivery retries after 15 minutes, not on every restart.

`event persist …: start/done` and `sqlite snapshot: VACUUM INTO start/done` show when the shared SQLite conn is held vs released (correlate with `[WA WARN] Node handling is taking long`).

## Tests

```bash
cd whatsapp2sqlite
go test ./...
go build -o whatsapp2sqlite ./cmd/whatsapp2sqlite
```

Tests live under `test/`. No live WhatsApp or Docker Postgres.
Go requires an importable package for subdirectory tests, so app code is `package whatsapp2sqlite` and the binary entrypoint is the thin `cmd/whatsapp2sqlite`.
