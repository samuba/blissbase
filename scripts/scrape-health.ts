/**
 * Per-site scrape health: detects layout/structure breakage, not just crashes.
 *
 * A site fails when:
 * - it returns no events (except ALLOW_EMPTY_SOURCES)
 * - more than MAX_INVALID_SHARE of events miss a required field (name, valid startAt)
 * - a field that is usually filled (baseline rate >= MIN_BASELINE_RATE) drops to zero,
 *   or below half its baseline rate (only with >= MIN_EVENTS_FOR_DROP_CHECK events, small samples are noisy)
 *
 * Baseline fill rates live in `scrape-health-baseline.json` and are refreshed with
 * `bun run scripts/scrape-websites.ts [source] --dry-run --write-baseline`.
 */
import type { ScrapedEvent } from '../src/lib/types.ts';

export const ALLOW_EMPTY_SOURCES = [`vortexapp`];
export const MAX_INVALID_SHARE = 0.2;
export const MIN_BASELINE_RATE = 0.5;
export const MAX_COVERAGE_DROP = 0.5;
export const MIN_EVENTS_FOR_DROP_CHECK = 10;

// sourceUrl is coverage, not required: soulwise blanks it on purpose for some hosts
const COVERAGE_FIELDS = {
    sourceUrl: (e) => /^https?:\/\/\S+$/.test(e.sourceUrl ?? ``),
    description: (e) => Boolean(e.description?.trim()),
    address: (e) => Boolean(e.address?.some((line) => line?.trim())),
    coordinates: (e) => Number.isFinite(e.latitude) && Number.isFinite(e.longitude),
    imageUrls: (e) => Boolean(e.imageUrls?.some(Boolean)),
    price: (e) => Boolean(e.price?.trim()),
    endAt: (e) => Boolean(e.endAt),
    host: (e) => Boolean(e.host?.trim()),
    hostLink: (e) => Boolean(e.hostLink?.trim()),
    contact: (e) => Boolean(e.contact?.length),
    tags: (e) => Boolean(e.tags?.length),
} satisfies Record<string, (event: ScrapedEvent) => boolean>;

export function missingRequiredFields(event: ScrapedEvent) {
    const missing: RequiredField[] = [];
    if (!event.name?.trim()) missing.push(`name`);
    if (!event.startAt || Number.isNaN(new Date(event.startAt).getTime())) missing.push(`startAt`);
    return missing;
}

export function fieldFillRates(events: ScrapedEvent[]) {
    const rates = {} as FieldFillRates;
    for (const [field, isFilled] of Object.entries(COVERAGE_FIELDS)) {
        const filled = events.filter(isFilled).length;
        rates[field as CoverageField] = events.length ? Math.round((filled / events.length) * 100) / 100 : 0;
    }
    return rates;
}

export function evaluateScrapeHealth({ source, events, baseline }: {
    source: string;
    events: ScrapedEvent[];
    baseline?: Partial<FieldFillRates>;
}): ScrapeHealth {
    const problems: string[] = [];
    const missingCounts: Record<RequiredField, number> = { name: 0, startAt: 0 };
    const validEvents: ScrapedEvent[] = [];

    for (const event of events) {
        const missing = missingRequiredFields(event);
        for (const field of missing) missingCounts[field]++;
        if (missing.length) continue;
        validEvents.push(event);
    }

    const invalidCount = events.length - validEvents.length;
    const fillRates = fieldFillRates(validEvents);
    const result = { source, problems, total: events.length, invalidCount, missingCounts, validEvents, fillRates };

    if (!events.length) {
        if (!ALLOW_EMPTY_SOURCES.includes(source)) problems.push(`no events found`);
        return { ...result, ok: !problems.length };
    }

    if (invalidCount / events.length > MAX_INVALID_SHARE) {
        const missingSummary = Object.entries(missingCounts)
            .filter(([, count]) => count)
            .map(([field, count]) => `${field}: ${count}`)
            .join(`, `);
        problems.push(`${invalidCount}/${events.length} events miss required fields (${missingSummary})`);
    }

    for (const [field, baselineRate] of Object.entries(baseline ?? {})) {
        if (baselineRate == null || baselineRate < MIN_BASELINE_RATE) continue;
        const rate = fillRates[field as CoverageField];
        if (rate == null) continue;
        const droppedToZero = rate === 0;
        const droppedSharply = validEvents.length >= MIN_EVENTS_FOR_DROP_CHECK && rate < baselineRate * MAX_COVERAGE_DROP;
        if (!droppedToZero && !droppedSharply) continue;
        problems.push(`${field} filled in ${percent(rate)} of events (baseline ${percent(baselineRate)})`);
    }

    return { ...result, ok: !problems.length };
}

export function formatScrapeHealthLine(health: ScrapeHealth) {
    const counts = `${health.validEvents.length} events, ${health.invalidCount} invalid${health.errorsLogged ? `, ${health.errorsLogged} errors logged` : ``}`;
    if (health.ok) return `OK   ${health.source}: ${counts}`;
    return `FAIL ${health.source}: ${health.problems.join(`; `)} (${counts})`;
}

export function formatFillRates(rates: FieldFillRates) {
    return Object.entries(rates).map(([field, rate]) => `${field} ${percent(rate)}`).join(`, `);
}

function percent(rate: number) {
    return `${Math.round(rate * 100)}%`;
}

type RequiredField = `name` | `startAt`;

export type CoverageField = keyof typeof COVERAGE_FIELDS;

export type FieldFillRates = Record<CoverageField, number>;

export type ScrapeHealthBaseline = Record<string, Partial<FieldFillRates>>;

export type ScrapeHealth = {
    source: string;
    ok: boolean;
    problems: string[];
    total: number;
    invalidCount: number;
    missingCounts: Record<RequiredField, number>;
    validEvents: ScrapedEvent[];
    fillRates: FieldFillRates;
    errorsLogged?: number;
};
