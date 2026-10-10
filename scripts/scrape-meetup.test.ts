import { describe, expect, it, vi } from "vitest";
import { collectMeetupEvents, mapMeetupEvent, parseMeetupInstant } from "./scrape-meetup.ts";

/** Build a Meetup-style offset datetime for an absolute UTC instant. */
function offsetIso({ utcMs, offsetHours, addMinutes = 0 }: { utcMs: number; offsetHours: number; addMinutes?: number }) {
	const wall = new Date(utcMs + addMinutes * 60_000 + offsetHours * 3_600_000);
	const y = wall.getUTCFullYear();
	const m = String(wall.getUTCMonth() + 1).padStart(2, `0`);
	const d = String(wall.getUTCDate()).padStart(2, `0`);
	const hh = String(wall.getUTCHours()).padStart(2, `0`);
	const mm = String(wall.getUTCMinutes()).padStart(2, `0`);
	const sign = offsetHours >= 0 ? `+` : `-`;
	const abs = String(Math.abs(offsetHours)).padStart(2, `0`);
	return `${y}-${m}-${d}T${hh}:${mm}:00${sign}${abs}:00`;
}

const startUtcMs = Date.now() + 7 * 24 * 60 * 60 * 1000;
const futureStart = offsetIso({ utcMs: startUtcMs, offsetHours: 2 });
const futureEnd = offsetIso({ utcMs: startUtcMs, offsetHours: 2, addMinutes: 90 });

const event = {
	id: `meetup-1`,
	title: `Evening Meditation Circle`,
	dateTime: futureStart,
	endTime: futureEnd,
	eventType: `PHYSICAL`,
	eventUrl: `https://www.meetup.com/example/events/123/`,
	description: `Breathe`,
	status: `ACTIVE`,
	group: { name: `Berlin Meditation`, urlname: `berlin-meditation`, timezone: `Europe/Berlin` },
	venue: { name: `Studio`, address: `Main St 1`, city: `Berlin`, country: `de`, lat: 52.52, lon: 13.4 },
};

describe(`parseMeetupInstant`, () => {
	it(`normalizes offset datetimes to UTC ISO`, () => {
		expect(parseMeetupInstant(`2026-10-17T09:30:00+02:00`)).toBe(`2026-10-17T07:30:00.000Z`);
		expect(parseMeetupInstant(`2026-10-14T19:30:00-04:00`)).toBe(`2026-10-14T23:30:00.000Z`);
		expect(parseMeetupInstant(`2026-10-14T19:30:00Z`)).toBe(`2026-10-14T19:30:00.000Z`);
	});

	it(`accepts compact offsets and strips IANA brackets`, () => {
		expect(parseMeetupInstant(`2026-10-14T19:30:00+0200`)).toBe(`2026-10-14T17:30:00.000Z`);
		expect(parseMeetupInstant(`2026-10-14T19:30:00+02:00[Europe/Berlin]`)).toBe(`2026-10-14T17:30:00.000Z`);
	});

	it(`rejects naive local datetimes that would follow the scraper machine TZ`, () => {
		expect(parseMeetupInstant(`2026-10-14T19:30:00`)).toBeUndefined();
		expect(parseMeetupInstant(`2026-10-14`)).toBeUndefined();
		expect(parseMeetupInstant(`not a date`)).toBeUndefined();
		expect(parseMeetupInstant(``)).toBeUndefined();
		expect(parseMeetupInstant(null)).toBeUndefined();
	});
});

describe(`mapMeetupEvent dates`, () => {
	it(`stores UTC instants and keeps the group IANA timezone`, () => {
		const mapped = mapMeetupEvent(event);

		expect(mapped?.startAt).toBe(parseMeetupInstant(event.dateTime));
		expect(mapped?.endAt).toBe(parseMeetupInstant(event.endTime));
		expect(mapped?.timezone).toBe(`Europe/Berlin`);
		expect(mapped?.startAt?.endsWith(`Z`)).toBe(true);
		// Absolute instant matches Meetup's offset wall clock
		expect(new Date(mapped!.startAt).getTime()).toBe(new Date(event.dateTime).getTime());
	});

	it(`matches scrape-websites Date conversion (no wall-clock shift)`, () => {
		const mapped = mapMeetupEvent(event);
		expect(mapped).toBeTruthy();
		const dbStart = new Date(mapped!.startAt);
		const dbEnd = new Date(mapped!.endAt!);
		expect(dbStart.toISOString()).toBe(mapped!.startAt);
		expect(dbEnd.toISOString()).toBe(mapped!.endAt);
		expect(dbEnd.getTime()).toBeGreaterThan(dbStart.getTime());
	});

	it(`drops end when it is before start`, () => {
		const start = offsetIso({ utcMs: startUtcMs, offsetHours: 1 });
		const endBefore = offsetIso({ utcMs: startUtcMs, offsetHours: 1, addMinutes: -60 });
		const mapped = mapMeetupEvent({
			...event,
			dateTime: start,
			endTime: endBefore,
		});
		expect(mapped?.startAt).toBe(parseMeetupInstant(start));
		expect(mapped?.endAt).toBeUndefined();
	});

	it(`skips past events and events without an offset start`, () => {
		expect(mapMeetupEvent({ ...event, dateTime: `2020-01-01T19:00:00+01:00` })).toBeUndefined();
		expect(
			mapMeetupEvent({
				...event,
				dateTime: offsetIso({ utcMs: startUtcMs, offsetHours: 2 }).replace(/[+-]\d{2}:\d{2}$/, ``),
			}),
		).toBeUndefined();
	});
});

describe(`collectMeetupEvents`, () => {
	it(`keeps going when one event fails to parse`, () => {
		const errorSpy = vi.spyOn(console, `error`).mockImplementation(() => {});
		const scraped = collectMeetupEvents([
			event,
			{
				...event,
				id: `broken`,
				get title(): string {
					throw new Error(`bad payload`);
				},
			},
			{ ...event, id: `second`, title: `Breathwork Circle`, eventUrl: `https://www.meetup.com/example/events/456/` },
		]);

		expect(scraped.map((item) => item.name)).toEqual([`Evening Meditation Circle`, `Breathwork Circle`]);
		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});
});
