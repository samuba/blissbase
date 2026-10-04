import { readFileSync } from "node:fs";
import { today } from "@internationalized/date";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "$lib/routes";
import { db, s } from "$lib/server/db";
import { upsertEvents } from "$lib/server/events";
import {
	breathworkEmbedCities,
	resolveBreathworkEmbedCity,
	searchBreathworkEmbedEvents,
	toBreathworkEmbedEvent,
} from "$lib/server/breathworkEmbed";

vi.mock(`$app/paths`, () => ({
	resolve: (path: string, params?: Record<string, string>) => {
		if (!params) return path;
		let resolved = path;
		for (const [key, value] of Object.entries(params)) {
			resolved = resolved.replace(`[${key}]`, value);
		}
		return resolved;
	},
}));

const zone = `Europe/Berlin`;
const source = `breathwork-embed-test`;

describe(`breathwork embed search`, () => {
	beforeEach(async () => {
		await db.delete(s.events).where(eq(s.events.source, source));
	});

	it(`returns breathwork events for the city and date, then the next page`, async () => {
		const start = today(zone);
		const inserted = await upsertEvents([
			event({ name: `Atemkreis Berlin`, daysAhead: 3, lat: 52.52, lng: 13.405, tagSlugs: [`breathwork`] }),
			event({ name: `Zweiter Atemkreis`, daysAhead: 4, lat: 52.51, lng: 13.4, tagSlugs: [`breathwork`] }),
			event({ name: `Yoga Berlin`, daysAhead: 3, lat: 52.52, lng: 13.405, tagSlugs: [`yoga`] }),
			event({ name: `Atemkreis Hamburg`, daysAhead: 3, lat: 53.5511, lng: 9.9937, tagSlugs: [`breathwork`] }),
			event({ name: `Später Atemkreis`, daysAhead: 80, lat: 52.52, lng: 13.405, tagSlugs: [`breathwork`] }),
		]);
		const berlin = inserted.find((item) => item.name === `Atemkreis Berlin`);

		const page = await searchBreathworkEmbedEvents({
			locationId: 195,
			start: start.toString(),
			end: start.add({ days: 40 }).toString(),
			limit: 1,
			searchTerm: `breathwork`,
		});

		expect(page.results.map((item) => item.name)).toEqual([`Atemkreis Berlin`]);
		expect(page.results[0]?.url).toBe(absoluteEventUrl(berlin?.slug));
		expect(page.results[0]?.venue).toContain(`Berlin`);
		expect(page.results[0]?.imageUrl).toBe(`https://example.com/atem.jpg`);
		expect(page.nextCursor).toBe(`1`);

		const next = await searchBreathworkEmbedEvents({
			locationId: `195`,
			start: start.toString(),
			end: start.add({ days: 40 }).toString(),
			limit: 8,
			cursor: page.nextCursor,
		});
		expect(next.results.map((item) => item.name)).toEqual([`Zweiter Atemkreis`]);
		expect(next.nextCursor).toBeNull();
	});

	it(`accepts a city name and returns nothing for an unknown city`, async () => {
		const start = today(zone);
		await upsertEvents([event({ name: `Atemkreis Hamburg`, daysAhead: 2, lat: 53.5511, lng: 9.9937, tagSlugs: [`breathwork`] })]);

		const found = await searchBreathworkEmbedEvents({
			city: `Hamburg`,
			start: start.toString(),
			end: start.add({ days: 40 }).toString(),
		});
		expect(found.results.map((item) => item.name)).toEqual([`Atemkreis Hamburg`]);

		const missing = await searchBreathworkEmbedEvents({
			locationId: 999,
			start: start.toString(),
			end: start.add({ days: 40 }).toString(),
		});
		expect(missing).toEqual({ results: [], nextCursor: null });
	});

	it(`returns an empty result for a bad date instead of throwing`, async () => {
		const result = await searchBreathworkEmbedEvents({
			locationId: 195,
			start: `not-a-date`,
			end: `2026-10-01`,
		});
		expect(result).toEqual({ results: [], nextCursor: null });
	});

	it(`skips an event that has no start`, () => {
		expect(toBreathworkEmbedEvent({ id: 1, name: `Ohne Datum`, slug: `ohne-datum`, startAt: null })).toBeNull();
	});

	it(`keeps the snippet cities and endpoint aligned with the server`, () => {
		const snippet = readFileSync(new URL(`../../../static/embed/event-search-snippet.js`, import.meta.url), `utf8`);
		expect(snippet).toContain(routes.breathworkEventSearch());
		expect(snippet).toContain(routes.breathworkEventSearchSnippet().split(`/`).pop());
		for (const city of breathworkEmbedCities) {
			expect(snippet).toContain(`id: \`${city.id}\`, name: \`${city.name}\``);
			expect(resolveBreathworkEmbedCity({ locationId: city.id })?.name).toBe(city.name);
		}
	});
});

function absoluteEventUrl(slug?: string) {
	return `https://blissbase.app/${slug}`;
}

function event(args: { name: string; daysAhead: number; lat: number; lng: number; tagSlugs: string[] }) {
	const startAt = today(zone).add({ days: args.daysAhead }).toDate(zone);
	startAt.setTime(startAt.getTime() + 18 * 60 * 60 * 1000);
	return {
		name: args.name,
		startAt,
		endAt: new Date(startAt.getTime() + 2 * 60 * 60 * 1000),
		source,
		description: `Breathwork embed test`,
		address: [`Beispielstraße 1`, args.lat > 53 ? `20457 Hamburg` : `10243 Berlin`],
		price: `10`,
		priceIsHtml: false,
		imageUrls: [`https://example.com/atem.jpg`],
		host: `Test Host`,
		contact: [],
		latitude: args.lat,
		longitude: args.lng,
		tagSlugs: args.tagSlugs,
		sourceUrl: `https://example.com/event`,
		listed: true,
		soldOut: false,
	};
}
