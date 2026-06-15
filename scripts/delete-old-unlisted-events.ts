import { and, eq, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import * as assets from '../src/lib/assets';
import { db, s } from '../src/lib/server/db.script.ts';

const cleanupAgeDays = 60;
const confirmDeleteFlag = `--confirm-delete`;
const dryRunFlag = `--dry-run`;

export async function main(args: { confirmed: boolean; dryRun: boolean }) {
	const cutoffDate = getCleanupCutoffDate({ ageDays: cleanupAgeDays });
	console.log(`Finding unlisted events older than ${cleanupAgeDays} days.`);
	console.log(`Cutoff date: ${cutoffDate.toISOString()}`);

	if (!args.confirmed && !args.dryRun) {
		throw new Error(`Refusing to delete events without ${confirmDeleteFlag}. Use ${dryRunFlag} to preview matches.`);
	}

	const mode = args.dryRun ? `dry run` : `live run`;
	const oldUnlistedEvents = args.dryRun ?
		await getOldUnlistedEvents({ cutoffDate }) :
		await deleteOldUnlistedEvents({ cutoffDate });
	const imageUrls = getEventImageUrls(oldUnlistedEvents);

	if (!oldUnlistedEvents?.length) {
		console.log(`No old unlisted events found.`);
		printCleanupSummary({
			mode,
			eventCount: 0,
			imageFileCount: 0
		});
		return;
	}

	const action = args.dryRun ? `Would delete` : `Deleted`;
	console.log(`${action} ${oldUnlistedEvents.length} old unlisted events.`);
	for (const event of oldUnlistedEvents) {
		const relevantDate = event.endAt ?? event.startAt;
		console.log(`${action} event ${event.id}: ${event.name} (${relevantDate.toISOString()})`);
	}

	if (!imageUrls?.length) {
		console.log(`No event images to delete.`);
		printCleanupSummary({
			mode,
			eventCount: oldUnlistedEvents.length,
			imageFileCount: 0
		});
		return;
	}

	if (args.dryRun) {
		console.log(`Would delete ${imageUrls.length} event images from R2.`);
		printCleanupSummary({
			mode,
			eventCount: oldUnlistedEvents.length,
			imageFileCount: imageUrls.length
		});
		return;
	}

	await deleteEventImages({ imageUrls });
	printCleanupSummary({
		mode,
		eventCount: oldUnlistedEvents.length,
		imageFileCount: imageUrls.length
	});
}

if (import.meta.main) {
	try {
		const cliArgs = process.argv.slice(2);
		const noArgsProvided = !cliArgs?.length;
		await main({
			confirmed: cliArgs.includes(confirmDeleteFlag),
			dryRun: noArgsProvided || cliArgs.includes(dryRunFlag) || cliArgs.includes(`-d`)
		});
		process.exit(0);
	} catch (error) {
		console.error(`Failed to delete old unlisted events:`, error);
		process.exit(1);
	}
}

/**
 * Finds unlisted events that ended before the cutoff date.
 * Events without an end date use their start date as the event age.
 *
 * @example
 * await getOldUnlistedEvents({ cutoffDate: new Date(`2026-01-01T00:00:00.000Z`) });
 */
async function getOldUnlistedEvents(args: { cutoffDate: Date }) {
	return await db
		.select({
			id: s.events.id,
			name: s.events.name,
			startAt: s.events.startAt,
			endAt: s.events.endAt,
			imageUrls: s.events.imageUrls
		})
		.from(s.events)
		.where(getOldUnlistedEventCondition({ cutoffDate: args.cutoffDate }));
}

/**
 * Deletes unlisted events that ended before the cutoff date.
 * Events without an end date use their start date as the event age.
 *
 * @example
 * await deleteOldUnlistedEvents({ cutoffDate: new Date(`2026-01-01T00:00:00.000Z`) });
 */
async function deleteOldUnlistedEvents(args: { cutoffDate: Date }) {
	return await db
		.delete(s.events)
		.where(getOldUnlistedEventCondition({ cutoffDate: args.cutoffDate }))
		.returning({
			id: s.events.id,
			name: s.events.name,
			startAt: s.events.startAt,
			endAt: s.events.endAt,
			imageUrls: s.events.imageUrls
		});
}

/**
 * Deletes event image objects from R2 and removes matching cache entries.
 *
 * @example
 * await deleteEventImages({ imageUrls: [`https://assets.blissbase.app/events/foo/bar.webp`] });
 */
async function deleteEventImages(args: { imageUrls: string[] }) {
	console.log(`Deleting ${args.imageUrls.length} event images from R2.`);
	await assets.deleteObjects(args.imageUrls, assets.loadCreds());
	await db.delete(s.imageCacheMap).where(inArray(s.imageCacheMap.url, args.imageUrls));
	console.log(`Deleted event images and image cache entries.`);
}

/**
 * Returns a deduplicated list of image URLs attached to deleted events.
 *
 * @example
 * getEventImageUrls([{ imageUrls: [`https://assets.blissbase.app/events/foo/bar.webp`] }]);
 */
function getEventImageUrls(events: { imageUrls: string[] | null }[]) {
	return [...new Set(events.flatMap((event) => event.imageUrls ?? []).filter((url) => url?.trim()))];
}

/**
 * Prints the final cleanup totals in a GitHub Actions friendly format.
 *
 * @example
 * printCleanupSummary({ mode: `live run`, eventCount: 3, imageFileCount: 4 });
 */
function printCleanupSummary(args: { mode: string; eventCount: number; imageFileCount: number }) {
	const action = args.mode === `dry run` ? `would be deleted` : `deleted`;
	console.log(``);
	console.log(`Cleanup summary (${args.mode})`);
	console.log(`Events ${action}: ${args.eventCount}`);
	console.log(`R2 image files ${action}: ${args.imageFileCount}`);
}

/**
 * Builds the database predicate for old unlisted events.
 *
 * @example
 * getOldUnlistedEventCondition({ cutoffDate: new Date(`2026-01-01T00:00:00.000Z`) });
 */
function getOldUnlistedEventCondition(args: { cutoffDate: Date }) {
	return and(
		eq(s.events.listed, false),
		or(
			and(isNotNull(s.events.endAt), lt(s.events.endAt, args.cutoffDate)),
			and(isNull(s.events.endAt), lt(s.events.startAt, args.cutoffDate))
		)
	);
}

/**
 * Calculates the cutoff timestamp for event cleanup.
 *
 * @example
 * getCleanupCutoffDate({ ageDays: 60 });
 */
function getCleanupCutoffDate(args: { ageDays: number }) {
	return new Date(Date.now() - args.ageDays * 24 * 60 * 60 * 1000);
}
