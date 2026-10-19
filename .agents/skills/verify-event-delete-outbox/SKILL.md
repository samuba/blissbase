---
name: verify-event-delete-outbox
description: "Formally verify that cleanupDeletedEvents / deleteOrphanedEventImages never deletes R2 or imageCacheMap URLs still referenced by a live event under scrape reuse. Use when changing the delete-outbox cron, orphan image cleanup, eventDeletedOutbox, MIN_AGE_MS, or scrapers that delete and re-insert events with the same image URLs."
---

# Verify event-delete outbox orphan safety

## Property

**Promise:** Cleanup never removes an image URL that any remaining live event still references.

**Harm if broken:** Scrapers delete and re-insert events that keep the same image URLs; deleting those URLs from R2 / `imageCacheMap` mass-breaks event covers.

**Tool:** TLA+ model checker (TLC from `tla2tools` 1.8.0). Ordering/reuse races need a model checker; TLC installs as one JAR (Java), reruns in under a second on this bound.

## When to run

Run this skill before merging changes that touch any of:

| Path | What it covers |
| --- | --- |
| `src/routes/api/cron/cleanupDeletedEvents/+server.ts` | `GET` drain loop, `deleteOrphanedEventImages`, `MIN_AGE_MS`, batch failure handling |
| `src/lib/server/schema.ts` (`eventDeletedOutbox` / deleted-event payload) | Outbox row shape (`event.image_urls`) |
| `src/lib/assets.ts` (`deleteObjects`) | R2 delete step the model treats as atomic with cache delete |
| Scrapers / `scripts/scrape-websites.ts` stale delete + upsert that reuse image URLs | `ScrapeReinsert` in the model |

If none of those change, you do not need this check for the current edit.

## How to run

Requires `java` on PATH. First run downloads a pinned `tla2tools` JAR into `~/.cache/blissbase-tlc/` (SHA checked in `run-tlc.sh`).

```bash
bun run formal:outbox
# equivalent:
bash .agents/skills/verify-event-delete-outbox/run-tlc.sh check
```

Expect: `Model checking completed. No error has been found.` and exit 0.

**Never** run DB migrations or schema-changing SQL as part of this skill.

## Keep the model true to the code

Model file: `.agents/skills/verify-event-delete-outbox/EventDeleteOutbox.tla`

| Model step | Code |
| --- | --- |
| `DeleteEvent` | `DELETE` on `events` → trigger enqueues `event_deleted_outbox` (`pending`, payload includes `image_urls`); R2 untouched |
| `ScrapeReinsert` | Scraper re-inserts an event that reuses a URL still in R2 (reason for `MIN_AGE_MS` in `+server.ts`) |
| `Tick` + `MinAge` | `createdAt < now - MIN_AGE_MS` gate before processing |
| `OrphanedUrls` / `ProcessPending` | `deleteOrphanedEventImages`: `arrayOverlaps` → `usedUrls` → delete only non-overlapping URLs, then mark outbox `done` |
| `FailPending` | `catch` path: bump `attempts`, stay `pending` or become `failed` at `MAX_ATTEMPTS`; **must not** delete R2 |

Config for the real filter: `EventDeleteOutbox.cfg` sets `SkipStillUsedCheck = 0`.

If you **intentionally** remove or bypass the `usedUrls` / `orphanedUrls` filter in `deleteOrphanedEventImages`, the model must set `SkipStillUsedCheck = 1` (use `EventDeleteOutboxBroken.cfg` / `bun run formal:outbox:broken`). Expect **invariant `LiveImagesPreserved` violated**. That failure is a real bug finding if the product still promises orphan-only deletes. Do not weaken the invariant to make it pass.

If you change control flow (e.g. mark `done` before R2 delete, drop the age gate, or delete cache without the overlap check), update the corresponding model step first so names and atomicity still match the code, then rerun. Move the sync commit below forward only after that confirmation.

## Counterexample in code words

When the still-used filter is missing (`SkipStillUsedCheck = 1`), TLC finds:

1. Two live events share image URL `u1`.
2. Delete one event → outbox `pending` with `{u1}` (R2 still has `u1`).
3. Clock passes `MinAge` (`MIN_AGE_MS`).
4. `ProcessPending` / `deleteOrphanedEventImages` deletes `u1` from R2 and cache even though the other event still lists it.
5. **`LiveImagesPreserved` violated** — live event references a URL no longer in R2.

## Tell a modeling error from a bug

- Replay the TLC trace against `+server.ts`. If a step cannot happen in code (e.g. process before age gate, delete R2 on the failure path), fix the **model**.
- If every step can happen and the invariant fails while the model matches the code, report a **bug** in product terms (which URL/events, which cron path). Do not edit product code unless asked; do not weaken the property.

## Bounds and what this does not cover

- **Bounds:** 2 URLs, 2 event slots, 2 outbox slots, clock `0..3`, `MinAge = 1`, `MaxAttempts = 2`. Exhaustive only inside that finite model.
- **Assumes:** one logical cleanup of a pending row is atomic (overlap check + R2 delete + cache delete + status update) like the `try` block; concurrent cron workers are not modeled; Meilisearch/search is out of scope (cron does not touch it); `done` retention purge is omitted (rows become `empty` after success); batch size 1000 collapsed to per-slot processing.
- **Not covered:** auth on the cron `Bearer` secret; partial R2 failure mid-`deleteObjects`; DB transaction isolation with live scrapes beyond the modeled race; offerings images.

## Prove the check can fail (scratch break)

Do this when regenerating or after a large model edit:

1. Scratch-break real code: in `deleteOrphanedEventImages`, delete `imageUrls` without filtering through `usedUrls` (or set `orphanedUrls = imageUrls`).
2. Keep the model honest: `bun run formal:outbox:broken` (or `SkipStillUsedCheck = 1`).
3. Expect exit non-zero and `Invariant LiveImagesPreserved is violated`.
4. Drop the scratch break; restore `SkipStillUsedCheck = 0`.
5. `bun run formal:outbox` must pass again.

## Sync commit

Last confirmed that this verification describes the code at:

`SYNC_COMMIT: 598b543fe7afc7f289ff10f4bad4283c3523c225` — commit that added this model; product outbox code matched `main` at `d82f0dc361fe6c2879c8a9c17609a6365696eb7d`. Move this forward only after reconfirming model↔code at a new commit.

Covered functions at sync: `GET` and `deleteOrphanedEventImages` in `src/routes/api/cron/cleanupDeletedEvents/+server.ts`.

## Maintenance

After merges that touched covered code without rechecking, use `/maintain-formal-verification-skill`.
)
