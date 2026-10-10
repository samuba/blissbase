import { describe, expect, it } from "vitest";
import { getDescription, mapEventbriteEvent, parseCliArgs } from "./scrape-eventbrite.ts";

const event = {
	id: `1979702056142`,
	name: ` (Vor Ort) Mantrasingen Kirtan `,
	url: `https://www.eventbrite.ch/e/vor-ort-mantrasingen-kirtan-inspiration-in-winikon-tickets-1979702056142`,
	summary: `Mantrasingen ist die einfachste und zugleich wirkungsvollste spirituelle Aktivität.`,
	start_date: `2026-10-13`,
	start_time: `19:00`,
	end_date: `2026-10-13`,
	end_time: `20:30`,
	timezone: `Europe/Zurich`,
	is_online_event: false,
	is_cancelled: false,
	tags: [{ display_name: `Meditation` }],
	image: { url: `https://img.evbuc.com/example.jpg` },
	primary_venue: {
		name: `Lotus`,
		address: {
			latitude: `47.2345864`,
			longitude: `8.047026`,
			localized_multi_line_address_display: [`9 Hinterdorfstrasse`, `6235 Winikon`],
		},
	},
	primary_organizer: {
		name: `Lotus Meditation Center`,
		url: `https://www.eventbrite.ch/o/lotus-meditation-center-52242947523`,
		website_url: `https://www.lotusmc.ch`,
	},
	ticket_availability: { is_free: true },
};

describe(`getDescription`, () => {
	it(`uses the full description html when present`, () => {
		const description = getDescription({
			event,
			fullDescription: `<div>Short teaser</div><div><p>Full body with <strong>details</strong>.</p><p>Second paragraph.</p></div>`,
		});

		expect(description).toContain(`Full body with <strong>details</strong>.`);
		expect(description).toContain(`Second paragraph.`);
		expect(description).not.toContain(`style=`);
	});

	it(`falls back to the search summary`, () => {
		const description = getDescription({ event });
		expect(description).toBe(
			`<p>Mantrasingen ist die einfachste und zugleich wirkungsvollste spirituelle Aktivität.</p>`,
		);
	});
});

describe(`parseCliArgs`, () => {
	it(`parses location query and --limit forms`, () => {
		expect(parseCliArgs([`Germany`])).toEqual({ query: `Germany`, limit: undefined });
		expect(parseCliArgs([`--limit`, `10`])).toEqual({ query: undefined, limit: 10 });
		expect(parseCliArgs([`-n`, `3`])).toEqual({ query: undefined, limit: 3 });
		expect(parseCliArgs([`Zürich`, `--limit=5`])).toEqual({ query: `Zürich`, limit: 5 });
		expect(parseCliArgs([`--limit`, `5`, `Byron`, `Bay`])).toEqual({ query: `Byron Bay`, limit: 5 });
	});

	it(`rejects invalid limits and unknown flags`, () => {
		expect(() => parseCliArgs([`--limit`, `0`])).toThrow(/Invalid --limit/);
		expect(() => parseCliArgs([`--limit=foo`])).toThrow(/Invalid --limit/);
		expect(() => parseCliArgs([`--wat`])).toThrow(/Unknown option/);
	});
});

describe(`mapEventbriteEvent`, () => {
	it(`maps search fields and prefers the full description`, () => {
		const mapped = mapEventbriteEvent({
			event,
			fullDescription: `<p>Long description about mantras and peace.</p>`,
		});

		expect(mapped).toMatchObject({
			name: `(Vor Ort) Mantrasingen Kirtan`,
			startAt: `2026-10-13T19:00:00+02:00`,
			price: `Free`,
			host: `Lotus Meditation Center`,
			source: `eventbrite`,
			sourceUrl: event.url,
		});
		expect(mapped?.description).toContain(`Long description about mantras and peace.`);
	});

	it(`skips events without a name, start, or url`, () => {
		expect(mapEventbriteEvent({ event: { ...event, name: `  ` } })).toBeUndefined();
		expect(mapEventbriteEvent({ event: { ...event, start_date: undefined } })).toBeUndefined();
		expect(mapEventbriteEvent({ event: { ...event, url: `not-a-url` } })).toBeUndefined();
	});
});
