import { describe, expect, it, vi } from 'vitest';
import {
	getAddress,
	getDescription,
	getEndAt,
	getHost,
	getHostLink,
	getImageUrls,
	getName,
	getPrice,
	getSourceUrl,
	getStartAt,
	getTags,
	mapSoulCollectiveEvent,
	parseCliArgs,
	parsePayloadItems,
} from './scrape-soulcollective.ts';

vi.mock(`../src/lib/server/google.script.ts`, () => ({
	geocodeAddressCached: vi.fn(async () => null),
}));

const offlineItem = {
	id: `item-1`,
	title: `PSYCHEDELIC BREATH & DANCE CLASS`,
	fullUrl: `/conscious-events-in-berlin/psychedelic-breath`,
	assetUrl: `https://images.squarespace-cdn.com/content/v1/abc/cover.jpg`,
	startDate: Date.parse(`2027-04-15T18:00:00.000Z`),
	endDate: Date.parse(`2027-04-15T21:00:00.000Z`),
	structuredContent: {
		_type: `CalendarEvent`,
		startDate: Date.parse(`2027-04-15T18:00:00.000Z`),
		endDate: Date.parse(`2027-04-15T21:00:00.000Z`),
	},
	location: {
		mapLat: 52.4770733,
		mapLng: 13.4221311,
		addressTitle: `Genezarethkirche`,
		addressLine1: `14 Herrfurthplatz`,
		addressLine2: `Berlin, BE, 12049`,
		addressCountry: `Germany`,
	},
	tags: [`Breathwork`],
	categories: [],
	excerpt: `<p><strong>Tickets: </strong>€25.42</p>`,
	body: `<div class="sqs-html-content"><p>Hosted by Roxana from <a href="https://www.instagram.com/thehealingberlin/">The Healing Berlin</a> in collaboration with KALEA</p><p>Join a night of breathwork.</p><p><strong>Tickets: </strong>€25.42</p><p><a href="mailto:hello@example.com">email</a></p></div>`,
};

const onlineItem = {
	id: `item-2`,
	title: `Radical Resonance Online Class`,
	fullUrl: `/conscious-events-in-berlin/radical-resonance-online-class`,
	assetUrl: `https://images.squarespace-cdn.com/content/v1/abc/online.jpg`,
	startDate: Date.parse(`2027-05-01T17:00:00.000Z`),
	endDate: Date.parse(`2027-05-01T18:30:00.000Z`),
	structuredContent: {
		startDate: Date.parse(`2027-05-01T17:00:00.000Z`),
		endDate: Date.parse(`2027-05-01T18:30:00.000Z`),
	},
	location: {
		addressTitle: `Online`,
		addressLine1: ``,
		addressLine2: ``,
		addressCountry: ``,
	},
	excerpt: `<p><strong>Tickets: </strong>sliding scale 20€ to 28€</p>`,
	body: `<div class="sqs-html-content"><p>Hosted by Maddalena Benedetto from Coming Home Yoga</p><p>Reconnect with your body.</p><p><strong>Tickets: </strong>sliding scale 20€ to 28€</p></div>`,
};

describe(`parseCliArgs`, () => {
	it(`parses --limit forms and leftover files`, () => {
		expect(parseCliArgs([])).toEqual({ limit: undefined, files: [] });
		expect(parseCliArgs([`--limit`, `10`])).toEqual({ limit: 10, files: [] });
		expect(parseCliArgs([`-n`, `3`, `a.json`])).toEqual({ limit: 3, files: [`a.json`] });
		expect(parseCliArgs([`--limit=5`])).toEqual({ limit: 5, files: [] });
		expect(() => parseCliArgs([`--limit`, `0`])).toThrow(/Invalid --limit/);
	});

	it(`ignores scrape-websites runner flags`, () => {
		expect(parseCliArgs([`soulcollective`, `--clean`, `--dry-run`])).toEqual({
			limit: undefined,
			files: [`soulcollective`],
		});
		expect(parseCliArgs([`--dry-run`, `--limit`, `7`, `--log-dir`, `scrape-logs`])).toEqual({
			limit: 7,
			files: [],
		});
	});
});

describe(`parsePayloadItems`, () => {
	it(`reads item, upcoming list, and detail envelopes`, () => {
		expect(parsePayloadItems(JSON.stringify(offlineItem))).toHaveLength(1);
		expect(parsePayloadItems(JSON.stringify({ upcoming: [offlineItem, onlineItem] }))).toHaveLength(2);
		expect(parsePayloadItems(JSON.stringify({ item: offlineItem }))[0]?.id).toBe(`item-1`);
		expect(parsePayloadItems(`not json`)).toEqual([]);
	});
});

describe(`field getters`, () => {
	it(`maps offline event fields from Squarespace JSON`, () => {
		expect(getName(offlineItem)).toBe(`PSYCHEDELIC BREATH & DANCE CLASS`);
		expect(getStartAt(offlineItem)).toBe(`2027-04-15T18:00:00.000Z`);
		expect(getEndAt(offlineItem)).toBe(`2027-04-15T21:00:00.000Z`);
		expect(getAddress(offlineItem)).toEqual([
			`Genezarethkirche`,
			`14 Herrfurthplatz`,
			`Berlin 12049`,
		]);
		expect(getPrice(offlineItem)).toBe(`€25.42`);
		expect(getHost(offlineItem)).toBe(`Roxana from The Healing Berlin`);
		expect(getHostLink(offlineItem)).toBe(`https://www.instagram.com/thehealingberlin/`);
		expect(getImageUrls(offlineItem)).toEqual([
			`https://images.squarespace-cdn.com/content/v1/abc/cover.jpg`,
		]);
		expect(getSourceUrl(offlineItem)).toBe(
			`https://www.soulcollective.eu/conscious-events-in-berlin/psychedelic-breath`,
		);
		expect(getTags(offlineItem)).toEqual([`Breathwork`]);
		expect(getDescription(offlineItem)).toContain(`Join a night of breathwork`);
	});

	it(`maps online events and sliding-scale prices`, () => {
		expect(getAddress(onlineItem)).toEqual([`Online`]);
		expect(getTags(onlineItem)).toEqual([`Online`]);
		expect(getPrice(onlineItem)).toBe(`sliding scale 20€ to 28€`);
		expect(getHost(onlineItem)).toBe(`Maddalena Benedetto from Coming Home Yoga`);
	});

	it(`dedupes repeated city tokens in addressLine2`, () => {
		expect(
			getAddress({
				...offlineItem,
				location: {
					addressTitle: `b23`,
					addressLine1: `23 Greifswalder Straße`,
					addressLine2: `Berlin, Berlin, 10405`,
					addressCountry: `Germany`,
				},
			}),
		).toEqual([`b23`, `23 Greifswalder Straße`, `Berlin 10405`]);
	});
});

describe(`mapSoulCollectiveEvent`, () => {
	it(`builds a scraped event and keeps listing coords`, async () => {
		const mapped = await mapSoulCollectiveEvent(offlineItem);
		expect(mapped).toMatchObject({
			name: `PSYCHEDELIC BREATH & DANCE CLASS`,
			source: `soulcollective`,
			sourceUrl: `https://www.soulcollective.eu/conscious-events-in-berlin/psychedelic-breath`,
			latitude: 52.4770733,
			longitude: 13.4221311,
			timezone: `Europe/Berlin`,
			price: `€25.42`,
			contact: [
				`https://www.instagram.com/thehealingberlin/`,
				`hello@example.com`,
			],
		});
		expect(mapped?.description).toContain(`Hosted by Roxana`);
	});

	it(`skips past events and incomplete payloads`, async () => {
		const errorSpy = vi.spyOn(console, `error`).mockImplementation(() => {});
		expect(
			await mapSoulCollectiveEvent({
				...offlineItem,
				startDate: Date.parse(`2020-01-01T10:00:00.000Z`),
				endDate: Date.parse(`2020-01-01T12:00:00.000Z`),
				structuredContent: {
					startDate: Date.parse(`2020-01-01T10:00:00.000Z`),
					endDate: Date.parse(`2020-01-01T12:00:00.000Z`),
				},
			}),
		).toBeUndefined();
		expect(await mapSoulCollectiveEvent({ ...offlineItem, title: ` ` })).toBeUndefined();
		errorSpy.mockRestore();
	});

});
