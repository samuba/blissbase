import { parseArgs } from "util";
import { WEBSITE_SCRAPER_CONFIG, WEBSITE_SCRAPE_SOURCES, type WebsiteScrapeSourceName } from "../src/lib/commonWithScripts.ts";
import { NotFoundError, REQUEST_DELAY_MS, customFetch, sleep, superTrim } from "./common.ts";

export const LIVE_SAMPLE_CAP = 10;

export function parseSampleLimit(raw: string | undefined): SampleLimit {
	if (raw === undefined) return 10 as SampleLimit;
	if (!/^\d+$/.test(raw)) {
		throw new Error(`--limit must be an integer from 1 to ${LIVE_SAMPLE_CAP}`);
	}
	const limit = Number(raw);
	if (limit < 1 || limit > LIVE_SAMPLE_CAP) {
		throw new Error(`--limit must be an integer from 1 to ${LIVE_SAMPLE_CAP}`);
	}
	return limit as SampleLimit;
}

export function parseVerifyArgs(argv: string[]): { source: WebsiteScrapeSourceName; limit: SampleLimit } {
	let parsed: ReturnType<typeof parseArgs<{ limit: { type: `string` } }>>;
	try {
		parsed = parseArgs({
			args: argv,
			strict: true,
			allowPositionals: true,
			options: {
				limit: { type: `string` },
			},
		});
	} catch (error) {
		throw usageError(errorReason(error));
	}

	if (!parsed.positionals.length) throw usageError();
	if (parsed.positionals.length > 1) throw usageError(`Expected one source.`);

	const rawSource = parsed.positionals[0] ?? ``;
	const source = rawSource.toLowerCase();
	if (!isWebsiteSource(source)) {
		throw new Error(`Unknown source "${rawSource}". Known sources: ${WEBSITE_SCRAPE_SOURCES.join(`, `)}`);
	}

	return { source, limit: parseSampleLimit(parsed.values.limit) };
}

export async function verifySource({ source, limit }: { source: WebsiteScrapeSourceName; limit: SampleLimit }): Promise<LiveReport> {
	const loaded = (await import(WEBSITE_SCRAPER_CONFIG[source].module)) as { liveProbe?: unknown };
	if (!isLiveProbe(loaded.liveProbe, source)) {
		return {
			kind: `unwitnessed`,
			source,
			exitCode: 2,
			summary: `unwitnessed: no liveProbe`,
		};
	}
	try {
		return await runLiveCheck({ probe: loaded.liveProbe, limit, fetchText: createFetchText() });
	} catch (error) {
		return listingFailed(source, errorReason(error));
	}
}

export async function runLiveCheck({
	probe,
	limit,
	fetchText,
}: {
	probe: LiveProbe;
	limit: SampleLimit;
	fetchText: FetchText;
}): Promise<LiveReport> {
	let targets: LiveTarget[];
	try {
		const listed = await probe.listTargets({ limit, fetchText });
		if (!Array.isArray(listed)) throw new Error(`liveProbe.listTargets must return an array`);
		targets = pickSample(listed, limit);
	} catch (error) {
		return listingFailed(probe.source, errorReason(error));
	}

	const pages: PageResult[] = [];
	for (const target of targets) {
		let body: string;
		try {
			body = await fetchText(target.url);
		} catch (error) {
			pages.push(pageFromFetchError({ url: target.url, error }));
			continue;
		}
		try {
			pages.push(compareReading(probe.read({ url: target.url, body })));
		} catch (error) {
			pages.push({ kind: `unreachable`, url: target.url, reason: errorReason(error) });
		}
	}

	return {
		kind: `checked`,
		source: probe.source,
		exitCode: exitCodeFor(pages),
		pages,
		summary: summarize(pages),
	};
}

export function compareReading(reading: LiveReading): PageVerdict {
	const mismatches: FieldMismatch[] = [];
	const gaps: Array<`name` | `startAt`> = [];

	const scraperName = superTrim(reading.scraper.name);
	const witnessName = superTrim(reading.witness.name);
	if (!witnessName) {
		gaps.push(`name`);
	} else if (!scraperName || scraperName !== witnessName) {
		mismatches.push({ field: `name`, scraper: scraperName, witness: witnessName });
	}

	const start = sameStart({
		scraperIso: reading.scraper.startAt,
		startDay: reading.witness.startDay,
		startAt: reading.witness.startAt,
	});
	if (start === `mismatch`) {
		mismatches.push({
			field: `startAt`,
			scraper: reading.scraper.startAt,
			witness: formatStartWitness(reading.witness),
		});
	} else if (start === `gap`) {
		gaps.push(`startAt`);
	}

	if (mismatches.length) return { kind: `mismatch`, url: reading.url, fields: mismatches };
	if (gaps.length) return { kind: `gap`, url: reading.url, fields: gaps };
	return { kind: `match`, url: reading.url };
}

export function formatLiveReport(report: LiveReport): string {
	const lines = [report.source];
	if (report.kind === `checked`) {
		for (const page of report.pages) lines.push(formatPage(page));
	}
	lines.push(report.summary);
	return `${lines.join(`\n`)}\n`;
}

function pickSample(targets: LiveTarget[], limit: SampleLimit): LiveTarget[] {
	const seen = new Set<string>();
	const unique: LiveTarget[] = [];
	for (const target of targets) {
		if (!target?.url || seen.has(target.url)) continue;
		seen.add(target.url);
		unique.push(target);
	}
	if (unique.length <= limit) return unique;
	if (limit === 1) return [unique[0]];

	const indexes: number[] = [];
	const used = new Set<number>();
	const span = unique.length - 1;
	for (let slot = 0; slot < limit; slot++) {
		let index = Math.round((slot * span) / (limit - 1));
		if (used.has(index)) {
			let step = 1;
			while (step <= span) {
				const right = index + step;
				const left = index - step;
				if (right <= span && !used.has(right)) {
					index = right;
					break;
				}
				if (left >= 0 && !used.has(left)) {
					index = left;
					break;
				}
				step++;
			}
		}
		used.add(index);
		indexes.push(index);
	}
	indexes.sort((a, b) => a - b);
	return indexes.map((index) => unique[index]);
}

function sameStart({
	scraperIso,
	startDay,
	startAt,
}: {
	scraperIso: string | undefined;
	startDay: string | undefined;
	startAt: string | undefined;
}): `match` | `mismatch` | `gap` {
	const day = startDay || undefined;
	const instant = startAt || undefined;
	if (!day && !instant) return `gap`;

	const scraperTime = scraperIso ? new Date(scraperIso).getTime() : Number.NaN;
	if (!scraperIso || Number.isNaN(scraperTime)) return `mismatch`;

	if (instant) {
		const witnessTime = new Date(instant).getTime();
		if (Number.isNaN(witnessTime)) {
			if (day && berlinDay(scraperIso) !== day) return `mismatch`;
			return `gap`;
		}
		if (witnessTime !== scraperTime) return `mismatch`;
	}

	if (day && berlinDay(scraperIso) !== day) return `mismatch`;
	return `match`;
}

function berlinDay(iso: string): string {
	const parts = new Intl.DateTimeFormat(`en-CA`, {
		timeZone: `Europe/Berlin`,
		year: `numeric`,
		month: `2-digit`,
		day: `2-digit`,
	}).formatToParts(new Date(iso));
	const year = parts.find((part) => part.type === `year`)?.value;
	const month = parts.find((part) => part.type === `month`)?.value;
	const day = parts.find((part) => part.type === `day`)?.value;
	return `${year}-${month}-${day}`;
}

function exitCodeFor(pages: PageResult[]): 0 | 1 | 2 {
	if (pages.some((page) => page.kind === `mismatch` || page.kind === `gone`)) return 1;
	if (!pages.some((page) => page.kind === `match`) || pages.some((page) => page.kind === `gap`)) return 2;
	return 0;
}

function isLiveProbe(value: unknown, source: WebsiteScrapeSourceName): value is LiveProbe {
	if (!value || typeof value !== `object`) return false;
	const probe = value as { source?: unknown; listTargets?: unknown; read?: unknown };
	return probe.source === source && typeof probe.listTargets === `function` && typeof probe.read === `function`;
}

function isWebsiteSource(value: string): value is WebsiteScrapeSourceName {
	return Object.hasOwn(WEBSITE_SCRAPER_CONFIG, value);
}

function createFetchText(): FetchText {
	return async (url) => {
		await sleep(REQUEST_DELAY_MS);
		const body = await customFetch(url, { returnType: `text`, maxRetries: 1 });
		if (typeof body !== `string`) throw new Error(`Expected text from ${url}`);
		return body;
	};
}

function pageFromFetchError({ url, error }: { url: string; error: unknown }): PageResult {
	const reason = errorReason(error);
	if (error instanceof NotFoundError || (error instanceof Error && error.name === `NotFoundError`)) {
		return { kind: `gone`, url, reason };
	}
	return { kind: `unreachable`, url, reason };
}

function formatStartWitness(witness: LiveReading[`witness`]): string {
	const parts: string[] = [];
	if (witness.startDay) parts.push(`day ${witness.startDay}`);
	if (witness.startAt) parts.push(`instant ${witness.startAt}`);
	return parts.join(`, `);
}

function formatPage(page: PageResult): string {
	if (page.kind === `match`) return `OK   ${page.url}`;
	if (page.kind === `gone`) return `GONE ${page.url} ${page.reason}`;
	if (page.kind === `unreachable`) return `SKIP ${page.url} ${page.reason}`;
	if (page.kind === `gap`) return page.fields.map((field) => `GAP  ${field} ${page.url}`).join(`\n`);
	return page.fields.map((field) => `FAIL ${field.field} scraper=${field.scraper ?? ``} witness=${field.witness} ${page.url}`).join(`\n`);
}

function summarize(pages: PageResult[]): string {
	const count = (kind: PageResult[`kind`]) => pages.filter((page) => page.kind === kind).length;
	return `${count(`match`)} matched, ${count(`mismatch`)} mismatched, ${count(`gap`)} gaps, ${count(`gone`)} gone, ${count(`unreachable`)} unreachable`;
}

function listingFailed(source: WebsiteScrapeSourceName, reason: string): LiveReport {
	return {
		kind: `listing-failed`,
		source,
		exitCode: 2,
		reason,
		summary: `listing failed: ${reason}`,
	};
}

function usageError(detail?: string): Error {
	const usage = `Usage: bun run scripts/verify-scrape-live.ts <source> [--limit n]`;
	if (!detail) return new Error(usage);
	return new Error(`${detail}\n${usage}`);
}

function errorReason(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.split(`\n`)[0] || `unknown error`;
}

if (import.meta.main && !process.env.VITEST) {
	try {
		const { source, limit } = parseVerifyArgs(process.argv.slice(2));
		const report = await verifySource({ source, limit });
		process.stdout.write(formatLiveReport(report));
		process.exit(report.exitCode);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`${message}\n`);
		process.exit(2);
	}
}

export type SampleLimit = number & { readonly __sampleLimit: `SampleLimit` };

export type FetchText = (url: string) => Promise<string>;

export type LiveProbe = {
	source: WebsiteScrapeSourceName;
	/**
	 * Detail URLs in listing order. The check samples this list, so the probe may return every URL.
	 * Let `fetchText` throw when the listing request fails. An empty array means the listing parsed and had no events.
	 */
	listTargets(args: { limit: SampleLimit; fetchText: FetchText }): Promise<LiveTarget[]>;
	/** Pure. No geocode, no database, no `scrapeWebsite`. */
	read(page: { url: string; body: string }): LiveReading;
};

export type LiveTarget = { url: string };

/**
 * `scraper` is the production parser on this body.
 * `witness` is a second reading that does not call that parser's preferred source.
 */
export type LiveReading = {
	url: string;
	scraper: { name: string | undefined; startAt: string | undefined };
	witness: {
		name: string | undefined;
		/** `YYYY-MM-DD` from a clock the production start parser does not own. */
		startDay: string | undefined;
		/** Independent instant. Omitted when the page has no second clock. */
		startAt: string | undefined;
	};
};

export type PageResult =
	| { kind: `match`; url: string }
	| { kind: `mismatch`; url: string; fields: FieldMismatch[] }
	| { kind: `gap`; url: string; fields: Array<`name` | `startAt`> }
	| { kind: `gone`; url: string; reason: string }
	| { kind: `unreachable`; url: string; reason: string };

export type FieldMismatch = {
	field: `name` | `startAt`;
	scraper: string | undefined;
	witness: string;
};

export type PageVerdict = Exclude<PageResult, { kind: `gone` } | { kind: `unreachable` }>;

export type LiveReport =
	| { kind: `unwitnessed`; source: WebsiteScrapeSourceName; exitCode: 2; summary: string }
	| { kind: `listing-failed`; source: WebsiteScrapeSourceName; exitCode: 2; reason: string; summary: string }
	| { kind: `checked`; source: WebsiteScrapeSourceName; exitCode: 0 | 1 | 2; pages: PageResult[]; summary: string };
