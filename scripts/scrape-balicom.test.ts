import { describe, expect, it } from 'vitest';
import {
	getAddress,
	getContact,
	getDescription,
	getEndAt,
	getHost,
	getHostLink,
	getImageUrls,
	getName,
	getOccurrenceDates,
	getPrice,
	getSourceUrl,
	getStartAt,
	getTags,
	type BaliComEventRow,
} from './scrape-balicom.ts';

const place = {
	id: `place-1`,
	place_name: `The Yoga Barn`,
	place_area: `Ubud`,
	place_lat: -8.5196,
	place_long: 115.2661,
	place_website: `https://www.theyogabarn.com`,
	place_instagram: `@theyogabarn`,
	place_url_slug: `/ubud/the-yoga-barn`,
	place_image_url: `https://example.com/place.jpg`,
	place_image_url_wp: null,
} satisfies NonNullable<BaliComEventRow[`places`]>;

const baseRow = {
	id: `evt-1`,
	event_status: `active`,
	event_name: `  Full Moon  Sound Healing  `,
	event_slug: `ubud-full-moon-sound-healing`,
	event_category: `Wellness & Spa`,
	event_area: `Ubud`,
	event_date: `2027-03-15`,
	event_fullday: false,
	event_time_begin: `19:00:00`,
	event_time_end: `21:30:00`,
	event_descr: `A restorative evening.\nBring a mat.`,
	event_image_url: `https://example.com/event.jpg`,
	venue_place_id: place.id,
	event_booking_url: `https://book.example.com/sound`,
	event_info_url: `https://info.example.com/sound`,
	event_gmap_url: `https://maps.google.com/?q=yoga+barn`,
	event_price: `free`,
	event_dates: [],
	event_recurrence_type: `single`,
	event_last_date: `2027-03-15`,
	places: place,
} satisfies BaliComEventRow;

describe(`scrape-balicom field extractors`, () => {
	it(`reads name, price, tags, source url and contacts`, () => {
		expect(getName(baseRow)).toBe(`Full Moon Sound Healing`);
		expect(getPrice(baseRow)).toBe(`Free`);
		expect(getTags(baseRow)).toEqual([`Wellness & Spa`, `Ubud`]);
		expect(getSourceUrl(baseRow)).toBe(
			`https://app.bali.com/events/ubud-full-moon-sound-healing`,
		);
		expect(getHost(baseRow)).toBe(`The Yoga Barn`);
		expect(getHostLink(baseRow)).toBe(`https://www.theyogabarn.com`);
		expect(getContact(baseRow)).toEqual([
			`https://book.example.com/sound`,
			`https://info.example.com/sound`,
			`https://www.theyogabarn.com`,
			`https://instagram.com/theyogabarn`,
			`https://maps.google.com/?q=yoga+barn`,
		]);
		expect(getImageUrls(baseRow)).toEqual([
			`https://example.com/event.jpg`,
			`https://example.com/place.jpg`,
		]);
		expect(getAddress(baseRow)).toEqual([`The Yoga Barn`, `Ubud`, `Bali`]);
	});

	it(`wraps plain-text descriptions into cleaned paragraphs`, () => {
		expect(getDescription(baseRow)).toContain(`A restorative evening.`);
		expect(getDescription(baseRow)).toContain(`Bring a mat.`);
	});

	it(`falls back to bali.com place slug and keeps event area when place area missing`, () => {
		const row = {
			...baseRow,
			places: {
				...place,
				place_website: null,
				place_instagram: null,
				place_area: null,
			},
		};
		expect(getHostLink(row)).toBe(`https://bali.com/ubud/the-yoga-barn`);
		expect(getAddress(row)).toEqual([`The Yoga Barn`, `Ubud`, `Bali`]);
	});
});

describe(`scrape-balicom times`, () => {
	const day = new Date(2027, 2, 15);

	it(`builds start/end in Asia/Makassar`, () => {
		expect(getStartAt({ row: baseRow, occurrenceDate: day })).toBe(`2027-03-15T19:00:00+08:00`);
		expect(getEndAt({ row: baseRow, occurrenceDate: day })).toBe(`2027-03-15T21:30:00+08:00`);
	});

	it(`rolls overnight ends to the next day`, () => {
		const overnight = {
			...baseRow,
			event_time_begin: `22:00:00`,
			event_time_end: `02:00:00`,
		};
		expect(getEndAt({ row: overnight, occurrenceDate: day })).toBe(`2027-03-16T02:00:00+08:00`);
	});

	it(`uses full-day bounds when flagged`, () => {
		const fullday = { ...baseRow, event_fullday: true };
		expect(getStartAt({ row: fullday, occurrenceDate: day })).toBe(`2027-03-15T00:00:00+08:00`);
		expect(getEndAt({ row: fullday, occurrenceDate: day })).toBe(`2027-03-15T23:59:00+08:00`);
	});
});

describe(`scrape-balicom occurrence dates`, () => {
	const rangeStart = new Date(2027, 2, 1);
	const rangeEnd = new Date(2027, 4, 1);

	it(`uses a single event_date when event_dates is empty`, () => {
		expect(
			getOccurrenceDates({ row: baseRow, rangeStart, rangeEnd }).map(formatLocal),
		).toEqual([`2027-03-15`]);
	});

	it(`merges event_date with event_dates like app.bali.com`, () => {
		const row = {
			...baseRow,
			event_date: `2027-03-15`,
			event_dates: [`2027-03-22`, `2027-03-29`, `2027-03-15`],
			event_recurrence_type: `custom`,
		};
		expect(
			getOccurrenceDates({ row, rangeStart, rangeEnd }).map(formatLocal),
		).toEqual([`2027-03-15`, `2027-03-22`, `2027-03-29`]);
	});

	it(`expands weekly recurrence when dates were not materialized`, () => {
		const row = {
			...baseRow,
			event_date: `2027-03-15`,
			event_dates: [],
			event_recurrence_type: `weekly`,
			event_last_date: `2027-04-05`,
		};
		expect(
			getOccurrenceDates({ row, rangeStart, rangeEnd }).map(formatLocal),
		).toEqual([`2027-03-15`, `2027-03-22`, `2027-03-29`, `2027-04-05`]);
	});

	it(`expands monthly recurrence when dates were not materialized`, () => {
		const row = {
			...baseRow,
			event_date: `2027-03-15`,
			event_dates: [],
			event_recurrence_type: `monthly`,
			event_last_date: `2027-05-15`,
		};
		expect(
			getOccurrenceDates({ row, rangeStart, rangeEnd }).map(formatLocal),
		).toEqual([`2027-03-15`, `2027-04-15`]);
	});
});

function formatLocal(date: Date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, `0`);
	const day = String(date.getDate()).padStart(2, `0`);
	return `${year}-${month}-${day}`;
}
