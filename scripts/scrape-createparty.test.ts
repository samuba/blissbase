import { describe, expect, it, vi } from "vitest";
import { collectCreatePartyEvents, mapCreatePartyEvent, nextPublicEventsStart } from "./scrape-createparty.ts";

vi.mock(`../src/lib/server/google.script.ts`, () => ({
	geocodeAddressCached: vi.fn(async () => null),
}));

const event = {
	id: `f57ca478-b3b9-43a8-8cd7-f331fa375acb`,
	name: ` SeNsuAL kiNkY PLAYFIGHT `,
	slug: `sensual-kinky-playfight`,
	beginAt: `2026-10-16T16:00:00.000Z`,
	location: `Münster, Germany`,
	description: `Hello <script>\n\nBring snacks`,
	price: 30,
	maxPrice: 45,
	coverImageUrl: `https://createparty.sirv.com/cover.webp`,
	maxGuests: 17,
	url: `https://create.party/e/sensual-kinky-playfight`,
};

describe(`mapCreatePartyEvent`, () => {
	it(`maps the public-events payload onto a scraped event`, () => {
		const mapped = mapCreatePartyEvent(event);

		expect(mapped).toMatchObject({
			name: `SeNsuAL kiNkY PLAYFIGHT`,
			startAt: `2026-10-16T16:00:00.000Z`,
			endAt: undefined,
			address: [`Münster`, `Germany`],
			price: `30 – 45€`,
			priceIsHtml: false,
			imageUrls: [`https://createparty.sirv.com/cover.webp`],
			host: undefined,
			hostLink: undefined,
			contact: [],
			tags: [],
			sourceUrl: `https://create.party/e/sensual-kinky-playfight`,
			source: `createparty`,
		});
		expect(mapped?.description).toContain(`<p>Hello &lt;script&gt;</p>`);
		expect(mapped?.description).toContain(`<p>Bring snacks</p>`);
		expect(mapped?.description).not.toContain(`<script>`);
	});

	it(`formats a single price and a free event`, () => {
		expect(mapCreatePartyEvent({ ...event, price: 12.5, maxPrice: null })?.price).toBe(`12,50€`);
		expect(mapCreatePartyEvent({ ...event, price: 0, maxPrice: 0 })?.price).toBe(`Kostenlos`);
		expect(mapCreatePartyEvent({ ...event, price: null, maxPrice: null })?.price).toBeUndefined();
	});

	it(`skips events without a name or start`, () => {
		expect(mapCreatePartyEvent({ ...event, name: `  ` })).toBeUndefined();
		expect(mapCreatePartyEvent({ ...event, beginAt: null })).toBeUndefined();
	});

	it(`builds a source url from the slug when url is missing`, () => {
		expect(mapCreatePartyEvent({ ...event, url: `` })?.sourceUrl).toBe(`https://create.party/e/sensual-kinky-playfight`);
	});
});

describe(`collectCreatePartyEvents`, () => {
	it(`keeps going when one event fails to parse`, async () => {
		const errorSpy = vi.spyOn(console, `error`).mockImplementation(() => {});
		const events = [
			event,
			{
				...event,
				id: `broken`,
				get name(): string {
					throw new Error(`bad payload`);
				},
			},
			{ ...event, id: `second`, name: `Cacao ceremony`, url: `https://create.party/e/cacao` },
		];

		const scraped = await collectCreatePartyEvents(events);

		expect(scraped.map((item) => item.name)).toEqual([`SeNsuAL kiNkY PLAYFIGHT`, `Cacao ceremony`]);
		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});
});

describe(`nextPublicEventsStart`, () => {
	it(`continues from the last event day when the page is full`, () => {
		const fullPage = Array.from({ length: 100 }, (_, index) => ({
			...event,
			id: String(index),
			beginAt: index < 99 ? `2026-10-01T10:00:00.000Z` : `2026-10-16T16:00:00.000Z`,
		}));

		expect(nextPublicEventsStart({ events: fullPage, pageSize: 100 })).toBe(`2026-10-16`);
	});

	it(`stops when the next window would not move forward`, () => {
		const fullPage = Array.from({ length: 100 }, (_, index) => ({
			...event,
			id: String(index),
			beginAt: `2026-10-16T16:00:00.000Z`,
		}));

		expect(nextPublicEventsStart({ start: `2026-10-16`, events: fullPage, pageSize: 100 })).toBeUndefined();
		expect(nextPublicEventsStart({ events: fullPage.slice(0, 2), pageSize: 100 })).toBeUndefined();
	});
});
