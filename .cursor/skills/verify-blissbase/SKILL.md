---
name: verify-blissbase
description: "Drive the Blissbase web app (SvelteKit event/offering discovery) the way a user does — launch an isolated Vite+PGlite instance, doctor it, exercise mapped features via Playwright data-testid handles, and capture proof. Use when verifying Blissbase UI behavior, proving a fix, or running a feature from features/."
---

# Verify Blissbase

Agent-facing control skill for the Blissbase web UI. Primary surface is the German-locale event/offering browser app. Secondary surfaces (scrape CLIs, Telegram admin, WhatsApp import) are out of scope here.

Harness CLI (always from repo root):

```bash
bun .cursor/skills/verify-blissbase/scripts/control-blissbase.ts <command> ...
```

Alias used below: `control-blissbase`. Put it on `PATH` if you want, or expand the bun invocation every time.

## Launch

Starts an isolated Vite dev server with `E2E_TEST=true` and an in-memory PGlite database (same model as `tests/e2e/helpers/worker-server.ts`). Never runs `drizzle` CLI migrations. Never points at production Supabase/Postgres.

```bash
control-blissbase launch [--run-id ID] [--port 5190]
```

Ready means:

1. Process is alive.
2. `POST /api/test/seed` with `{ action: "getEventById", data: { id: 0 } }` returns HTTP 200 (DB usable, E2E gates open).
3. `/`, `/offerings`, `/events/new`, `/offerings/new` each return status &lt; 500 (Vite warmup done).

State lands in `/tmp/blissbase-verify-$RUN_ID/state.json`. The active run id is written to `.cursor/skills/verify-blissbase/.active-run`. Prefer port `5190+` so you do not collide with a human `bun run dev` on `5173` or Playwright workers on `5174+`.

Teardown: `control-blissbase cleanup` (never `pkill -f vite`).

## Doctor

Read-only. Run before the first drive and after any surprise:

```bash
control-blissbase doctor
```

Requires: pid alive, seed API OK, homepage status &lt; 500, listening port owned by our pid, revision recorded. Exit code `2` means do not drive — relaunch or fix.

## Drive

Prefer the existing Playwright conventions: locate only via `data-testid` / `getByTestId`. Locale is `de-DE` with `Accept-Language: de`.

```bash
control-blissbase browser start
control-blissbase browser goto --path /
control-blissbase browser wait --testid event-card
control-blissbase browser hydrate
control-blissbase browser fill --testid event-search-input --value Yoga
control-blissbase browser press --key Enter
control-blissbase browser expect-visible --testid event-card-title --text "Yoga Flow Class"
control-blissbase browser click --testid event-card
control-blissbase browser sign-in   # sets e2e_user_id / e2e_user_email cookies
control-blissbase browser stop
```

Seed fixtures through the same E2E seed API the Playwright suite uses:

```bash
control-blissbase seed reset
control-blissbase seed baseline    # meditation + yoga + online events
control-blissbase seed meditation
control-blissbase seed yoga
control-blissbase seed online
```

Read the feature map under `features/` before driving. Each feature file is the recipe. A proof that only hits one convenient entry point is incomplete when the map lists others.

Auth for signed-in journeys: `browser sign-in` (E2E cookies consumed by `hooks.server.ts` when `E2E_TEST=true` and `dev`). Anonymous OTP create-flows use fixed OTP `123456` (see `src/lib/server/e2eAuth.ts`) and still need Google Places mocks for offline location — follow `tests/e2e/helpers/create-flow.ts` patterns when extending the harness.

## Evidence

Proof artifacts live under:

`.cursor/skills/verify-blissbase/artifacts/<feature-id>/`

Standards:

- Exercise the real user path (homepage search box, event card click, filter dialog). Do not call internal stores or production-only APIs as a substitute.
- Capture the action and the resulting state (ARIA snapshot + screenshot with Blissbase identity visible — logo / brand heading).
- For mutations, confirm via a second user-facing view or a read-only seed lookup (`getEventBySlug`), not only a toast.
- Record the feature id and entry point in the artifact filenames or snapshot header.
- Cleanup must never delete this directory.

Example:

```bash
control-blissbase browser snapshot --path event-search/results.aria.txt
control-blissbase browser screenshot --path event-search/results.png
```

## Cleanup

```bash
control-blissbase cleanup
```

Stops the Vite process group started by `launch` and the persistent Chromium daemon started by `browser start`. Removes scratch under `/tmp/blissbase-verify-$RUN_ID/` session files. Leaves `artifacts/` untouched. After cleanup, confirm evidence still exists at the named path.

## Helpers

| Helper | Invocation |
| --- | --- |
| Control CLI | `bun .cursor/skills/verify-blissbase/scripts/control-blissbase.ts <command>` |
| Feature map | `.cursor/skills/verify-blissbase/features/README.md` |
| Upstream E2E reference | `tests/e2e/README.md`, `tests/e2e/helpers/*` |

Do not invent a second server model. If the control CLI is missing a selector helper you need, extend it — do not shell out to ad-hoc Playwright one-liners that skip doctor/cleanup.

## Isolate

Two verification runs can coexist when they use different `--run-id` values (distinct ports, `SVELTEKIT_OUTDIR`, Vite cache dirs, PGlite memories). Never drive a shared human `bun run dev` session or a Playwright worker you did not start. Refuse rather than corrupt someone else's cookies/DB.

## Maintenance

Keep the map honest with `/maintain-verification-skill` as the app changes.
