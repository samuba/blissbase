import { describe, expect, it } from "vitest";
import {
	getAddress,
	getContact,
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
	mapFitraEvent,
	parseCliArgs,
	parsePayloadRows,
} from "./scrape-fitra.ts";

const runEvent = {
	id: `1895f195-3045-4a43-a48a-69020d3a29fd`,
	name: `Continuum Long Run`,
	description: `Easy long run. Enjoy the community vibes and epic views.\n\nAll are welcome.`,
	category: `Run`,
	location: `Jl. Babadan No.89, Pererenan, Kec. Mengwi, Kabupaten Badung, Bali 80351`,
	location_name: `Le Bajo Bali`,
	location_lat: -8.6369245,
	location_lng: 115.1248646,
	starts_at: `2027-01-16T23:00:00+00:00`,
	ends_at: null,
	payment_type: `free`,
	price_idr: 0,
	cover_image_url: null,
	cover_images: null,
	external_registration_url: null,
	status: `live`,
	event_host: {
		id: `0d3a9e9b-7ac7-4597-9afb-99dfbc13d9de`,
		name: `Continuum Athletics`,
		instagram: `Continuum.athletics`,
		website: null,
		whatsapp: null,
	},
	gym_host: null,
	vendor_host: null,
};

const yttcEvent = {
	id: `971de795-79a5-42dd-b470-3632cda92279`,
	name: `BALI 200H VINYASA YTTC`,
	description: `Join our 200-Hour Yoga Teacher Training in Bali.`,
	category: `Yoga`,
	location: `YogaUnion Bali Fire Shala, Ubud, Gianyar, Bali`,
	location_name: `YogaUnion`,
	location_lat: -8.4992815,
	location_lng: 115.2577424,
	starts_at: `2026-12-13T06:00:00+00:00`,
	ends_at: `2027-01-04T03:00:00+00:00`,
	payment_type: `pay_at_door`,
	price_idr: 44136500,
	cover_image_url: `https://oeofpukhwfhqgmlubyoj.supabase.co/storage/v1/object/public/covers/events/cover.jpg`,
	cover_images: [
		`https://oeofpukhwfhqgmlubyoj.supabase.co/storage/v1/object/public/covers/events/cover.jpg`,
		`https://oeofpukhwfhqgmlubyoj.supabase.co/storage/v1/object/public/covers/events/gallery.jpg`,
	],
	external_registration_url: `https://yogaunionbali.com/bali-courses/200-hour-yoga-teacher-training-in-bali/`,
	status: `live`,
	event_host: null,
	gym_host: {
		id: `703225af-bac3-4cd4-ad1f-bbc53e3c083e`,
		name: `YogaUnion`,
		instagram: `https://www.instagram.com/yogaunionbali?rpxt=abc`,
		website: `https://yogaunionbali.com/`,
		whatsapp: `+62 819-5337-1173`,
	},
	vendor_host: null,
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
		expect(parseCliArgs([`fitra`, `--clean`, `--dry-run`])).toEqual({
			limit: undefined,
			files: [],
		});
	});
});

describe(`field getters`, () => {
	it(`maps free run event fields`, () => {
		expect(getName(runEvent)).toBe(`Continuum Long Run`);
		expect(getStartAt(runEvent)).toBe(`2027-01-16T23:00:00+00:00`);
		expect(getEndAt(runEvent)).toBeUndefined();
		expect(getAddress(runEvent)).toEqual([
			`Le Bajo Bali`,
			`Jl. Babadan No.89, Pererenan, Kec. Mengwi, Kabupaten Badung, Bali 80351`,
		]);
		expect(getPrice(runEvent)).toBe(`Free`);
		expect(getHost(runEvent)).toBe(`Continuum Athletics`);
		expect(getHostLink(runEvent)).toBe(`https://instagram.com/Continuum.athletics`);
		expect(getTags(runEvent)).toEqual([`Run`]);
		expect(getSourceUrl(runEvent)).toBe(
			`https://fitra.asia/events/1895f195-3045-4a43-a48a-69020d3a29fd`,
		);
		expect(getDescription(runEvent)).toContain(`Easy long run`);
		expect(getImageUrls(runEvent)).toEqual([]);
	});

	it(`maps paid gym-hosted event with contacts and images`, () => {
		expect(getPrice(yttcEvent)).toBe(`IDR 44,136,500`);
		expect(getHost(yttcEvent)).toBe(`YogaUnion`);
		expect(getHostLink(yttcEvent)).toBe(`https://yogaunionbali.com/`);
		expect(getContact(yttcEvent)).toEqual([
			`https://yogaunionbali.com/`,
			`https://instagram.com/yogaunionbali`,
			`https://wa.me/6281953371173`,
			`https://yogaunionbali.com/bali-courses/200-hour-yoga-teacher-training-in-bali/`,
		]);
		expect(getImageUrls(yttcEvent)).toHaveLength(2);
		expect(getEndAt(yttcEvent)).toBe(`2027-01-04T03:00:00+00:00`);
	});
});

describe(`mapFitraEvent`, () => {
	it(`returns a ScrapedEvent for upcoming rows`, () => {
		const mapped = mapFitraEvent(runEvent);
		expect(mapped?.source).toBe(`fitra`);
		expect(mapped?.timezone).toBe(`Asia/Makassar`);
		expect(mapped?.latitude).toBe(-8.6369245);
		expect(mapped?.longitude).toBe(115.1248646);
		expect(mapped?.priceIsHtml).toBe(false);
	});

	it(`skips past events`, () => {
		expect(
			mapFitraEvent({
				...runEvent,
				starts_at: `2020-01-01T00:00:00+00:00`,
				ends_at: null,
			}),
		).toBeUndefined();
	});
});

describe(`parsePayloadRows`, () => {
	it(`accepts a single object or an array`, () => {
		expect(parsePayloadRows(JSON.stringify(runEvent))).toHaveLength(1);
		expect(parsePayloadRows(JSON.stringify([runEvent, yttcEvent]))).toHaveLength(2);
	});
});
