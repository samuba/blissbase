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

The live directory stays `/home/walter/whatsapp2sqlite`. It is not a git checkout. Runtime files in that directory are never deleted or overwritten:

- `whatsapp.sqlite`, `whatsapp.sqlite-wal`, `whatsapp.sqlite-shm`
- spare copies such as `whatsapp copy.sqlite` (and `-wal` / `-shm`)
- `config.jsonc`, `notify.env`, `.notify-incident.json`, `.notify-incident-*.tmp`
- `media/`, `group_contacts_phone_numbers.txt`
- any other untracked file (old source files included)

A sparse clone of blissbase lives at `/home/walter/.local/share/blissbase-whatsapp2sqlite`. Each deploy fetches and resets **that clone only**, runs tests, and builds `./cmd/whatsapp2sqlite` to a temp file. The file must be an ELF executable. The live directory is not modified if tests or the build fail. After the build succeeds, the script copies git-tracked files onto the live directory, stops the user service `whatsapp2sqlite`, saves the current binary as `whatsapp2sqlite.prev`, moves the new binary into place, and starts the service. If the new process does not stay up, it restores `.prev` and starts that again.

Run it from a Mac checkout of this repo. The script SSHs to the host and runs **this** copy there (the copy already on the server is not used):

```bash
cd whatsapp2sqlite
./deployWhatsapp2Sqlite.sh
```

Pass a branch to deploy it instead of the default branch: `./deployWhatsapp2Sqlite.sh my-branch`.

If the log stops before `Stopping whatsapp2sqlite`, the service was not stopped.

### One-time migration

The directory on the server today is a plain folder (source copied in by the old script, plus the live SQLite session). The first run of this script must be told to adopt it. `--migrate` does not delete anything and does not move the database.

On the Mac, from a checkout that contains this script:

```bash
ssh walter@waltersbox 'gh auth status && go version && git --version && test -f ~/whatsapp2sqlite/whatsapp.sqlite && echo sqlite-ok'

cd whatsapp2sqlite
./deployWhatsapp2Sqlite.sh --migrate
```

Without `--migrate`, the script exits before it clones or copies, and tells you to re-run with `--migrate`.

What that run does, as user `walter`:

1. Leaves `/home/walter/whatsapp2sqlite` in place. It refuses to deploy if that directory contains `.git`.
2. Creates `/home/walter/.local/share/blissbase-whatsapp2sqlite` as a sparse clone (`whatsapp2sqlite/` only). If that path already exists and is not that clone, the script exits and does not delete it.
3. Aborts if any tracked file matches a runtime path, or if `.gitignore` does not ignore the runtime names above.
4. Runs tests and builds `./cmd/whatsapp2sqlite` to a temp file. If either fails, the live directory is not modified and the service is not stopped. The build must be a real ELF binary (building the library package root produces an archive and is rejected).
5. Copies only tracked files onto the live directory. SQLite, config, `notify.env`, media, and every other untracked file stay byte-for-byte, including files git no longer has.
6. Stops `whatsapp2sqlite`, writes the previous binary to `whatsapp2sqlite.prev`, swaps the new binary in, and starts the service.

Confirm:

```bash
ssh walter@waltersbox 'systemctl --user is-active whatsapp2sqlite; ls -la ~/whatsapp2sqlite/whatsapp.sqlite ~/whatsapp2sqlite/whatsapp.sqlite-wal ~/whatsapp2sqlite/whatsapp.sqlite-shm ~/whatsapp2sqlite/config.jsonc ~/whatsapp2sqlite/notify.env ~/whatsapp2sqlite/.notify-incident.json ~/whatsapp2sqlite/media ~/whatsapp2sqlite/group_contacts_phone_numbers.txt'
```

The log lines `Keeping whatsapp.sqlite` and `Deployment completed successfully` are the ones to look for.

Later deploys omit `--migrate`:

```bash
./deployWhatsapp2Sqlite.sh
./deployWhatsapp2Sqlite.sh my-branch
```

You can also copy this script to the server and run `~/whatsapp2sqlite/deployWhatsapp2Sqlite.sh --migrate` as `walter`. Do not run an older copy of the script for that first adoption.

Rollback to the previous binary:

```bash
ssh walter@waltersbox 'systemctl --user stop whatsapp2sqlite && cp -a ~/whatsapp2sqlite/whatsapp2sqlite.prev ~/whatsapp2sqlite/whatsapp2sqlite && systemctl --user start whatsapp2sqlite'
```

Do not `rm` the live directory, and do not `git clean` the clone. If the clone has extra files, the script stops and leaves them there. Move them aside by hand. Source files removed upstream are left on disk in the live directory; the binary is built from the clone, not from those copies.

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
