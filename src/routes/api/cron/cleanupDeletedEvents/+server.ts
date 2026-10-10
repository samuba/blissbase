import { error, json, type RequestHandler } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import * as assets from "$lib/assets";
import { eventAssetsCreds } from "$lib/events.remote.shared";
import { and, arrayOverlaps, asc, db, eq, inArray, lt, s } from "$lib/server/db";
import type { DeletedEventRow } from "$lib/server/schema";

// cron job: cleanupDeletedEvents

const MAX_ATTEMPTS = 5;
// Scrapers delete and re-insert events with the same image urls, so give them time to finish.
const MIN_AGE_MS = 60 * 60 * 1000;
const DONE_RETENTION_MS = 60 * 24 * 60 * 60 * 1000;

export const GET: RequestHandler = async ({ request }) => {
	if (!env.CRON_SECRET || request.headers.get(`authorization`) !== `Bearer ${env.CRON_SECRET}`) {
		return error(401, `Unauthorized`);
	}

	const rows = await db
		.select()
		.from(s.eventDeletedOutbox)
		.where(and(
			eq(s.eventDeletedOutbox.status, `pending`),
			// lt(s.eventDeletedOutbox.createdAt, new Date(Date.now() - MIN_AGE_MS))
		))
		.orderBy(asc(s.eventDeletedOutbox.createdAt))
		.limit(200);

	let doneCount = 0;
	let failedCount = 0;
	for (const row of rows) {
		const attempts = row.attempts + 1;
		try {
			await onEventDeleted(row.event);
			await db
				.update(s.eventDeletedOutbox)
				.set({ status: `done`, attempts, lastError: null, processedAt: new Date() })
				.where(eq(s.eventDeletedOutbox.id, row.id));
			doneCount++;
		} catch (err) {
			console.error(`Failed to clean up deleted event ${row.event.id}:`, err);
			failedCount++;
			await db
				.update(s.eventDeletedOutbox)
				.set({
					status: attempts >= MAX_ATTEMPTS ? `failed` : `pending`,
					attempts,
					lastError: err instanceof Error ? err.message : String(err)
				})
				.where(eq(s.eventDeletedOutbox.id, row.id));
		}
	}

	const purged = await db
		.delete(s.eventDeletedOutbox)
		.where(and(
			eq(s.eventDeletedOutbox.status, `done`),
			lt(s.eventDeletedOutbox.createdAt, new Date(Date.now() - DONE_RETENTION_MS))
		))
		.returning({ id: s.eventDeletedOutbox.id });

	const result = { processedCount: rows.length, doneCount, failedCount, purgedOutboxEntriesCount: purged.length };
	console.log(`Cleaned up deleted events:`, result);
	return json(result);
};

async function onEventDeleted(event: DeletedEventRow) {
	await deleteOrphanedEventImages(event);
}

/**
 * Deletes the deleted event's images from R2 and the image cache,
 * skipping urls that are still used by another event (e.g. merged duplicates or re-scraped events).
 */
async function deleteOrphanedEventImages(event: DeletedEventRow) {
	const imageUrls = [...new Set(event.image_urls?.filter((url) => url?.trim()) ?? [])];
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
