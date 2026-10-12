import { error, json, type RequestHandler } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import * as assets from "$lib/assets";
import { eventAssetsCreds } from "$lib/events.remote.shared";
import { and, arrayOverlaps, asc, db, eq, inArray, lt, s, sql } from "$lib/server/db";
import type { DeletedEventRow } from "$lib/server/schema";

// cron job: cleanupDeletedEvents

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 1000;
// Scrapers delete and re-insert events with the same image urls, so give them time to finish.
const MIN_AGE_MS = 60 * 60 * 1000;
const DONE_RETENTION_MS = 60 * 24 * 60 * 60 * 1000;

export const GET: RequestHandler = async ({ request }) => {
	if (!env.CRON_SECRET || request.headers.get(`authorization`) !== `Bearer ${env.CRON_SECRET}`) {
		return error(401, `Unauthorized`);
	}

	let processedCount = 0;
	let doneCount = 0;
	let failedCount = 0;

	while (true) {
		const rows = await db
			.select()
			.from(s.eventDeletedOutbox)
			.where(and(
				eq(s.eventDeletedOutbox.status, `pending`),
				lt(s.eventDeletedOutbox.createdAt, new Date(Date.now() - MIN_AGE_MS))
			))
			.orderBy(asc(s.eventDeletedOutbox.createdAt))
			.limit(BATCH_SIZE);

		if (!rows?.length) break;

		processedCount += rows.length;
		const rowIds = rows.map((row) => row.id);

		try {
			// Events are already gone from DB (and any search index) via the delete trigger;
			// this outbox only cleans orphaned R2 images + imageCacheMap rows.
			await deleteOrphanedEventImages(rows.map((row) => row.event));
			await db
				.update(s.eventDeletedOutbox)
				.set({
					status: `done`,
					attempts: sql`${s.eventDeletedOutbox.attempts} + 1`,
					lastError: null,
					processedAt: new Date()
				})
				.where(inArray(s.eventDeletedOutbox.id, rowIds));
			doneCount += rows.length;
		} catch (err) {
			console.error(`Failed to clean up deleted event images:`, err);
			failedCount += rows.length;
			const lastError = err instanceof Error ? err.message : String(err);
			// Shared blob cleanup failed together — attribute the failure to every row in this run.
			for (const row of rows) {
				const attempts = row.attempts + 1;
				await db
					.update(s.eventDeletedOutbox)
					.set({
						status: attempts >= MAX_ATTEMPTS ? `failed` : `pending`,
						attempts,
						lastError
					})
					.where(eq(s.eventDeletedOutbox.id, row.id));
			}
			// Stop so we don't immediately re-pick the same still-pending rows.
			break;
		}

		if (rows.length < BATCH_SIZE) break;
	}

	const purged = await db
		.delete(s.eventDeletedOutbox)
		.where(and(
			eq(s.eventDeletedOutbox.status, `done`),
			lt(s.eventDeletedOutbox.createdAt, new Date(Date.now() - DONE_RETENTION_MS))
		))
		.returning({ id: s.eventDeletedOutbox.id });

	const result = { processedCount, doneCount, failedCount, purgedOutboxEntriesCount: purged.length };
	console.log(`Cleaned up deleted events:`, result);
	return json(result);
};

/**
 * Deletes orphaned images for many deleted events in one pass:
 * one overlap check, one R2 deleteObjects call, one imageCacheMap delete.
 * Skips urls still used by another event (e.g. merged duplicates or re-scraped events).
 */
async function deleteOrphanedEventImages(events: DeletedEventRow[]) {
	const imageUrls = [...new Set(events.flatMap((event) => event.image_urls?.filter((url) => url?.trim()) ?? []))];
	if (!imageUrls?.length) return;

	const eventsStillUsingImages = await db
		.select({ imageUrls: s.events.imageUrls })
		.from(s.events)
		.where(arrayOverlaps(s.events.imageUrls, imageUrls));
	const usedUrls = new Set(eventsStillUsingImages.flatMap((x) => x.imageUrls));
	const orphanedUrls = imageUrls.filter((url) => !usedUrls.has(url));
	if (!orphanedUrls?.length) return;

	await assets.deleteObjects(orphanedUrls, eventAssetsCreds);
	await db.delete(s.imageCacheMap).where(inArray(s.imageCacheMap.url, orphanedUrls));
}
