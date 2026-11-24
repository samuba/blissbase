import { describe, expect, it, vi } from "vitest";
import {
	getAddress,
	getContact,
	getDescription,
	getHost,
	getHostLink,
	getImageUrls,
	getName,
	getPrice,
	getSourceUrl,
	getTags,
	mapKnowmadsRowSync,
	parseCliArgs,
	parseKnowmadsPayload,
} from "./scrape-knowmadsbali.ts";

vi.mock(`../src/lib/server/google.script.ts`, () => ({
	geocodeAddressCached: vi.fn(async () => null),
}));

const datedEvent = {
	id: `evt-1`,
	title: `FUNDRAISING MOVIE NIGHT AT JIWA GARDEN`,
	description: `Screening How to Live on Earth.\n\nCome early.`,
	category: `kids-activities`,
	startDate: `2026-11-24T00:00:00.000Z`,
	endDate: null,
	startTime: `18:00`,
	endTime: null,
	imageUrl: `/event-covers/fundraising-movie-night.jpg`,
	isPublished: true,
	slug: `fundraising-movie-night-at-jiwa-garden`,
	featured: false,
	isMajor: false,
	withKids: true,
	priceInfo: null,
	area: `Pererenan`,
	address: `Jiwa Community Garden`,
	externalUrl: null,
	contactEmail: null,
	instagramUrl: `https://www.instagram.com/p/example/`,
	openingHours: null,
};

const weeklyEvent = {
	id: `evt-2`,
	title: `Sunset Yoga with Setya Tantra at Beachwalk`,
	description: `Weekly sunset yoga on the deck.`,
	category: `festivals`,
	startDate: null,
	endDate: null,
	startTime: null,
	endTime: null,
	imageUrl: `https://example.com/yoga.jpg`,
	isPublished: true,
	slug: `sunset-yoga-with-setya-tantra-at-beachwalk`,
	featured: false,
	isMajor: false,
	withKids: false,
	priceInfo: `Free`,
	area: `Kuta`,
	address: `Sunset Deck, Level 3, beachwalk Shopping Center`,
	externalUrl: `https://wa.me/6285975213567`,
	contactEmail: `hello@beachwalkbali.com`,
	instagramUrl: `https://www.instagram.com/beachwalk_bali`,
	openingHours: {
		fri: { open: `17:30`, close: `00:00` },
		mon: null,
		sat: null,
		sun: null,
		thu: null,
		tue: null,
		wed: null,
	},
};

const longSpanEvent = {
	...datedEvent,
	id: `evt-3`,
	title: `Private Dinner with Alpacas`,
	slug: `private-dinner-with-alpacas`,
	startDate: `2026-08-13T00:00:00.000Z`,
	endDate: `2026-12-03T00:00:00.000Z`,
	startTime: `18:30`,
	endTime: `02:20`,
	openingHours: null,
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
		expect(parseCliArgs([`knowmadsbali`, `--clean`, `--dry-run`])).toEqual({
			limit: undefined,
			files: [`knowmadsbali`],
		});
		expect(parseCliArgs([`--dry-run`, `--limit`, `7`, `--log-dir`, `scrape-logs`])).toEqual({
			limit: 7,
			files: [],
		});
	});
});

describe(`parseKnowmadsPayload`, () => {
	it(`reads array, single item, and events envelope`, () => {
		expect(parseKnowmadsPayload(JSON.stringify([datedEvent]))).toHaveLength(1);
		expect(parseKnowmadsPayload(JSON.stringify(datedEvent))[0]?.slug).toBe(
			`fundraising-movie-night-at-jiwa-garden`,
		);
		expect(parseKnowmadsPayload(JSON.stringify({ events: [datedEvent, weeklyEvent] }))).toHaveLength(
			2,
		);
		expect(parseKnowmadsPayload(`not json`)).toEqual([]);
	});
});

describe(`field getters`, () => {
	it(`maps name, address, images, tags, and contacts`, () => {
		expect(getName(datedEvent)).toBe(`FUNDRAISING MOVIE NIGHT AT JIWA GARDEN`);
		expect(getAddress(datedEvent)).toEqual([`Jiwa Community Garden`, `Pererenan`, `Bali`]);
		expect(getImageUrls(datedEvent)).toEqual([
			`https://knowmadsbali.com/event-covers/fundraising-movie-night.jpg`,
		]);
		expect(getTags(datedEvent)).toEqual([`kids-activities`, `kids`, `Pererenan`]);
		expect(getContact(weeklyEvent)).toEqual([
			`hello@beachwalkbali.com`,
			`https://www.instagram.com/beachwalk_bali`,
			`https://wa.me/6285975213567`,
		]);
		expect(getPrice(weeklyEvent)).toBe(`Free`);
		expect(getPrice({ ...weeklyEvent, priceInfo: `Free entry` })).toBe(`Free`);
		expect(getPrice({ ...weeklyEvent, priceInfo: `Paid` })).toBeUndefined();
		expect(getHost(datedEvent)).toBe(`Knowmads Bali`);
		expect(getHostLink(datedEvent)).toBe(`https://knowmadsbali.com`);
		expect(getSourceUrl(datedEvent)).toBe(
			`https://knowmadsbali.com/en/events/fundraising-movie-night-at-jiwa-garden`,
		);
		expect(getDescription(datedEvent)).toContain(`<p>Screening How to Live on Earth.</p>`);
	});
});

describe(`mapKnowmadsRowSync`, () => {
	it(`maps a dated event into Asia/Makassar wall time`, () => {
		const [event] = mapKnowmadsRowSync(datedEvent);
		expect(event?.name).toBe(`FUNDRAISING MOVIE NIGHT AT JIWA GARDEN`);
		expect(event?.startAt).toBe(`2026-11-24T18:00:00+08:00`);
		expect(event?.endAt).toBeUndefined();
		expect(event?.source).toBe(`knowmadsbali`);
		expect(event?.timezone).toBe(`Asia/Makassar`);
	});

	it(`skips long-running dated listings without weekly hours`, () => {
		expect(mapKnowmadsRowSync(longSpanEvent)).toEqual([]);
	});

	it(`expands weekly openingHours into dated occurrences when title matches whitelist`, () => {
		const events = mapKnowmadsRowSync(weeklyEvent);
		expect(events?.length).toBeGreaterThan(0);
		expect(events.every((event) => event.sourceUrl.includes(`?date=`))).toBe(true);
		expect(events.every((event) => event.startAt.includes(`T17:30:00+08:00`))).toBe(true);
		expect(events.every((event) => event.endAt?.includes(`T00:00:00+08:00`))).toBe(true);
	});

	it(`skips weekly rows that miss the whitelist`, () => {
		expect(
			mapKnowmadsRowSync({
				...weeklyEvent,
				title: `All You Can Eat BBQ Night`,
				slug: `all-you-can-eat-bbq-night`,
			}),
		).toEqual([]);
	});

	it(`prefers dated mapping when startDate is present alongside openingHours`, () => {
		const [event] = mapKnowmadsRowSync({
			...datedEvent,
			openingHours: weeklyEvent.openingHours,
		});
		expect(event?.startAt).toBe(`2026-11-24T18:00:00+08:00`);
		expect(event?.sourceUrl).not.toContain(`?date=`);
	});

	it(`rolls overnight endTime past midnight on the same calendar day`, () => {
		const [event] = mapKnowmadsRowSync({
			...datedEvent,
			startTime: `18:30`,
			endTime: `02:20`,
			endDate: `2026-11-24T00:00:00.000Z`,
		});
		expect(event?.endAt).toBe(`2026-11-25T02:20:00+08:00`);
	});

	it(`skips unpublished rows`, () => {
		expect(mapKnowmadsRowSync({ ...datedEvent, isPublished: false })).toEqual([]);
	});
});
