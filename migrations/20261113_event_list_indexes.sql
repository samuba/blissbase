-- Event list indexes and planner stats.
--
-- Apply this yourself on the direct (non-pooling) connection. Do not run it with
-- `bun run db:migrate` / `drizzle-kit migrate`: that migrator wraps the whole file
-- in one transaction, and CREATE INDEX CONCURRENTLY cannot run inside a transaction.
-- This repo has no drizzle migration journal; schema changes normally go out with
-- `db:push`, which also does not emit CONCURRENTLY.
--
-- The same index definitions (without CONCURRENTLY) are declared in
-- src/lib/server/schema.ts. After this file is applied, a later db:push sees them
-- as already present. Do not db:push this change before applying the file, or push
-- will build the same indexes without CONCURRENTLY and lock writes on `events`.
--
--   psql "$DATABASE_URL_NON_POOLING" -v ON_ERROR_STOP=1 -f migrations/20261113_event_list_indexes.sql
--
-- Column order matches src/lib/server/events.ts fetchEvents:
-- listed is always an equality predicate, then start_at or end_at is a range.
-- A btree only ranges on the first column after the equalities, so listed leads.
-- endsInRange and spansRange both require end_at IS NOT NULL, so that index is partial.
-- source and author_id are separate equality / foreign-key indexes. source is optional
-- on the public list, so it is not folded into the listed+time indexes.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "events_listed_start_at_idx" ON "events" USING btree ("listed","start_at");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "events_listed_end_at_idx" ON "events" USING btree ("listed","end_at") WHERE "events"."end_at" is not null;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "events_source_idx" ON "events" USING btree ("source");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "events_author_id_idx" ON "events" USING btree ("author_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "favorites_event_id_idx" ON "favorites" USING btree ("event_id");

-- One-off planner stats refresh. Safe to re-run. Not a schema change.
ANALYZE image_cache_map;
ANALYZE geocode_cache;
ANALYZE event_deleted_outbox;
