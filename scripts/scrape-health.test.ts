import { describe, expect, it } from 'vitest';
import type { ScrapedEvent } from '../src/lib/types.ts';
import { evaluateScrapeHealth, fieldFillRates, formatScrapeHealthLine, missingRequiredFields } from './scrape-health.ts';

describe(`missingRequiredFields`, () => {
	it(`accepts a complete event`, () => {
		expect(missingRequiredFields(event())).toEqual([]);
	});

	it(`flags empty name and unparsable startAt`, () => {
		expect(missingRequiredFields(event({ name: `  `, startAt: `kein Datum` }))).toEqual([`name`, `startAt`]);
	});

	it(`does not require sourceUrl`, () => {
		expect(missingRequiredFields(event({ sourceUrl: `` }))).toEqual([]);
	});
});

describe(`fieldFillRates`, () => {
	it(`computes the share of events with each field filled`, () => {
		const rates = fieldFillRates([event(), event({ description: ``, imageUrls: [], latitude: null, sourceUrl: `/events/1` })]);
		expect(rates.sourceUrl).toBe(0.5);
		expect(rates.description).toBe(0.5);
		expect(rates.imageUrls).toBe(0.5);
		expect(rates.coordinates).toBe(0.5);
		expect(rates.address).toBe(1);
	});

	it(`returns 0 for every field when there are no events`, () => {
		expect(Object.values(fieldFillRates([])).every((rate) => rate === 0)).toBe(true);
	});
});

describe(`evaluateScrapeHealth`, () => {
	it(`passes a healthy site`, () => {
		const health = evaluateScrapeHealth({ source: `tribehaus`, events: [event(), event()] });
		expect(health.ok).toBe(true);
		expect(health.validEvents).toHaveLength(2);
	});

	it(`fails when no events were found`, () => {
		const health = evaluateScrapeHealth({ source: `tribehaus`, events: [] });
		expect(health.ok).toBe(false);
		expect(health.problems).toEqual([`no events found`]);
	});

	it(`allows empty results for whitelisted sources`, () => {
		expect(evaluateScrapeHealth({ source: `vortexapp`, events: [] }).ok).toBe(true);
	});

	it(`drops invalid events but stays healthy under the threshold`, () => {
		const events = [...Array(9).fill(null).map(() => event()), event({ name: `` })];
		const health = evaluateScrapeHealth({ source: `tribehaus`, events });
		expect(health.ok).toBe(true);
		expect(health.invalidCount).toBe(1);
		expect(health.validEvents).toHaveLength(9);
	});

	it(`fails when too many events miss required fields`, () => {
		const events = [event(), event({ startAt: `` }), event({ startAt: `` })];
		const health = evaluateScrapeHealth({ source: `tribehaus`, events });
		expect(health.ok).toBe(false);
		expect(health.problems).toEqual([`2/3 events miss required fields (startAt: 2)`]);
	});

	it(`fails when a usually filled field drops sharply`, () => {
		const events = [...events10({ description: `` }).slice(0, 7), ...events10().slice(0, 3)];
		const health = evaluateScrapeHealth({ source: `tribehaus`, events, baseline: { description: 0.9 } });
		expect(health.ok).toBe(false);
		expect(health.problems).toEqual([`description filled in 30% of events (baseline 90%)`]);
	});

	it(`ignores sharp drops on small samples but still fails on drops to zero`, () => {
		const small = [event({ description: `` }), event({ description: `` }), event()];
		expect(evaluateScrapeHealth({ source: `createparty`, events: small, baseline: { description: 0.9 } }).ok).toBe(true);

		const none = small.map((e) => ({ ...e, description: `` }));
		expect(evaluateScrapeHealth({ source: `createparty`, events: none, baseline: { description: 0.9 } }).problems)
			.toEqual([`description filled in 0% of events (baseline 90%)`]);
	});

	it(`tolerates moderate coverage drops and ignores rarely filled baseline fields`, () => {
		const events = [event({ price: null }), event(), event({ hostLink: null }), event({ hostLink: null })];
		const health = evaluateScrapeHealth({ source: `tribehaus`, events, baseline: { price: 1, hostLink: 0.3 } });
		expect(health.ok).toBe(true);
	});

	it(`formats a failure line with problems and counts`, () => {
		const health = evaluateScrapeHealth({ source: `tribehaus`, events: [event({ imageUrls: [] })], baseline: { imageUrls: 1 } });
		expect(formatScrapeHealthLine({ ...health, errorsLogged: 3 }))
			.toBe(`FAIL tribehaus: imageUrls filled in 0% of events (baseline 100%) (1 events, 0 invalid, 3 errors logged)`);
	});
});

function events10(overrides: Partial<ScrapedEvent> = {}) {
	return Array.from({ length: 10 }, () => event(overrides));
}

function event(overrides: Partial<ScrapedEvent> = {}): ScrapedEvent {
	return {
		name: `Ecstatic Dance`,
		startAt: `2026-10-20T19:00:00+02:00`,
		endAt: `2026-10-20T22:00:00+02:00`,
		address: [`Hauptstraße 1`, `10115 Berlin`],
		price: `20 €`,
		priceIsHtml: false,
		description: `<p>Tanzen</p>`,
		imageUrls: [`https://example.com/a.jpg`],
		host: `Anna`,
		hostLink: `https://example.com/anna`,
		contact: [`anna@example.com`],
		latitude: 52.5,
		longitude: 13.4,
		tags: [`Dance`],
		sourceUrl: `https://example.com/events/1`,
		source: `tribehaus`,
		...overrides,
	};
}
