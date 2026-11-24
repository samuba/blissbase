import {
	ensureSourceOrigins,
	mergeSourceOrigins,
	type EventSourceOrigin,
} from "../src/lib/server/eventSourceOrigins";

const applyFlag = `--apply`;
const batchSize = 200;

/**
 * Builds the origins that should be stored for an event, enriching messenger
 * labels from known chat/room names when the stored label is still a raw id.
 *
 * @example
 * planSourceOriginsBackfill({
 *   event: { source: `telegram`, sourceChatIdsTelegram: [`-1001`], sourceOrigins: [] },
 *   telegramNames: new Map([[`-1001`, `Berlin Conscious`]]),
 *   whatsappNames: new Map(),
 * })
 */
export function planSourceOriginsBackfill(args: {
	event: {
		source?: string | null;
		sourceUrl?: string | null;
		sourceChatIdsTelegram?: string[] | null;
		sourceChatIdsWhatsapp?: string[] | null;
		sourceOrigins?: EventSourceOrigin[] | null;
	};
	telegramNames: Map<string, string>;
	whatsappNames: Map<string, string>;
}) {
	const origins = ensureSourceOrigins(args.event).map((origin) =>
		enrichMessengerLabel({
			origin,
			telegramNames: args.telegramNames,
			whatsappNames: args.whatsappNames,
		}),
	);
	return mergeSourceOrigins(origins);
}

/**
 * True when the planned origins differ from what is already stored.
 */
export function sourceOriginsNeedBackfill(args: {
	stored?: EventSourceOrigin[] | null;
	planned: EventSourceOrigin[];
}) {
	return !sameOrigins(args.stored ?? [], args.planned);
}

/**
 * Fills `events.source_origins` from classic source fields (+ messenger names).
 * Dry-run unless `--apply`.
 *
 * @example
 * bun run scripts/backfill-source-origins.ts
 * bun run scripts/backfill-source-origins.ts --apply
 * bun run scripts/backfill-source-origins.ts --limit=50
 */
async function backfillSourceOrigins(args: { apply: boolean; limit: number | null }) {
	const { db, eq, s } = await import("../src/lib/server/db.script");
	const mode = args.apply ? `apply` : `dry run`;
	console.log(`Backfilling events.source_origins (${mode})`);

	const [telegramTargets, whatsappTargets, whatsappChats] = await Promise.all([
		db.query.telegramScrapingTargets.findMany({
			columns: { roomId: true, name: true },
		}),
		db.query.whatsappScrapingTargets.findMany({
			columns: { chatJid: true, name: true },
		}),
		db.query.whatsappChats.findMany({
			columns: { chatJid: true, name: true },
		}),
	]);

	const telegramNames = new Map<string, string>();
	for (const row of telegramTargets) {
		if (row.name?.trim()) telegramNames.set(row.roomId, row.name.trim());
	}

	const whatsappNames = new Map<string, string>();
	for (const row of whatsappChats) {
		if (row.name?.trim()) whatsappNames.set(row.chatJid, row.name.trim());
	}
	for (const row of whatsappTargets) {
		if (row.name?.trim()) whatsappNames.set(row.chatJid, row.name.trim());
	}

	const queriedEvents = await db.query.events.findMany({
		columns: {
			id: true,
			name: true,
			source: true,
			sourceUrl: true,
			sourceChatIdsTelegram: true,
			sourceChatIdsWhatsapp: true,
			sourceOrigins: true,
		},
		orderBy: (events, { asc }) => [asc(events.id)],
	});
	const events = args.limit === null ? queriedEvents : queriedEvents.slice(0, args.limit);

	const toUpdate: BackfillUpdate[] = [];
	let failed = 0;

	for (const event of events) {
		try {
			const planned = planSourceOriginsBackfill({
				event,
				telegramNames,
				whatsappNames,
			});
			if (!sourceOriginsNeedBackfill({ stored: event.sourceOrigins, planned })) continue;

			toUpdate.push({
				id: event.id,
				name: event.name,
				original: event.sourceOrigins ?? [],
				sourceOrigins: planned,
			});
		} catch (error) {
			failed += 1;
			console.error(`Failed planning origins for event ${event.id}:`, error);
		}
	}

	printSample(toUpdate);
	console.log(`Scanned ${events.length} events`);
	console.log(`${toUpdate.length} events need source_origins backfill`);
	if (failed) console.log(`Failed to plan ${failed} events`);

	if (!args.apply) {
		console.log(`Dry run only. Re-run with ${applyFlag} to write source_origins.`);
		return;
	}

	let updated = 0;
	for (const batch of chunk(toUpdate, batchSize)) {
		for (const row of batch) {
			try {
				await db
					.update(s.events)
					.set({ sourceOrigins: row.sourceOrigins })
					.where(eq(s.events.id, row.id));
				updated += 1;
			} catch (error) {
				failed += 1;
				console.error(`Failed updating event ${row.id}:`, error);
			}
		}
	}

	console.log(`Updated ${updated} events`);
	if (failed) console.log(`Failed updates/plans: ${failed}`);
	console.log(`Re-run without ${applyFlag} and confirm that 0 events need backfill.`);
}

function enrichMessengerLabel(args: {
	origin: EventSourceOrigin;
	telegramNames: Map<string, string>;
	whatsappNames: Map<string, string>;
}): EventSourceOrigin {
	const { origin } = args;
	if (origin.type !== `telegram` && origin.type !== `whatsapp`) return origin;
	if (!origin.chatId) return origin;

	const name =
		origin.type === `telegram`
			? args.telegramNames.get(origin.chatId)
			: args.whatsappNames.get(origin.chatId);
	if (!name) return origin;
	if (origin.label !== origin.chatId && origin.label.trim()) return origin;
	return { ...origin, label: name };
}

function sameOrigins(a: EventSourceOrigin[], b: EventSourceOrigin[]) {
	if (a.length !== b.length) return false;
	return a.every((origin, index) => {
		const other = b[index];
		return (
			origin.type === other.type &&
			origin.label === other.label &&
			(origin.chatId ?? null) === (other.chatId ?? null) &&
			(origin.url ?? null) === (other.url ?? null)
		);
	});
}

function printSample(rows: BackfillUpdate[]) {
	if (!rows.length) return;
	console.log(`Sample backfills:`);
	for (const row of rows.slice(0, 10)) {
		console.log(
			`  ${row.id} ${row.name}: ${formatOrigins(row.original)} → ${formatOrigins(row.sourceOrigins)}`,
		);
	}
	if (rows.length > 10) console.log(`  ...`);
}

function formatOrigins(origins: EventSourceOrigin[]) {
	if (!origins.length) return `[]`;
	return origins
		.map((origin) => {
			const chat = origin.chatId ? `:${origin.chatId}` : ``;
			return `${origin.type}:${origin.label}${chat}`;
		})
		.join(`, `);
}

function chunk<T>(items: T[], size: number) {
	const batches: T[][] = [];
	for (let index = 0; index < items.length; index += size) {
		batches.push(items.slice(index, index + size));
	}
	return batches;
}

function parseLimit(args: string[]) {
	const limitArg = args.find((arg) => arg.startsWith(`--limit=`));
	if (!limitArg) return null;
	const value = Number(limitArg.slice(`--limit=`.length));
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`Invalid --limit value`);
	}
	return value;
}

if (import.meta.main) {
	try {
		const cliArgs = process.argv.slice(2);
		if (cliArgs.includes(`--help`) || cliArgs.includes(`-h`)) {
			console.log(`Usage: bun run scripts/backfill-source-origins.ts [--apply] [--limit=N]`);
			process.exit(0);
		}
		await backfillSourceOrigins({
			apply: cliArgs.includes(applyFlag),
			limit: parseLimit(cliArgs),
		});
		process.exit(0);
	} catch (error) {
		console.error(`Failed backfilling source origins:`, error);
		process.exit(1);
	}
}

type BackfillUpdate = {
	id: number;
	name: string;
	original: EventSourceOrigin[];
	sourceOrigins: EventSourceOrigin[];
};
