import { describe, expect, it } from "vitest";
import {
	getAddress,
	getContact,
	getDescription,
	getHost,
	getImageUrls,
	getName,
	getPrice,
	getTags,
	mapBaliLiveEvent,
	parseCliArgs,
	passesNameLists,
	wallToIso,
} from "./scrape-balilive.ts";

const detail = {
	id: 9001,
	title: `Cacao Ceremony & Sound Healing`,
	slug: `cacao-ceremony-sound-healing`,
	entry: `free`,
	metaDescription: `A cacao ceremony in Ubud.`,
	content: {
		blocks: [
			{
				type: `paragraph`,
				data: { text: `Join us for cacao and sound healing.` },
			},
			{
				type: `paragraph`,
				data: { text: `For more information WhatsApp: &#43;62 811 3821 9512` },
			},
		],
	},
	types: [
		{ id: 1, name: `Wellness` },
		{ id: 2, name: `Music` },
	],
	eventDates: [
		{ startAt: `2026-12-01 18:00:00`, endAt: `2026-12-01 20:00:00` },
		{ startAt: `2026-12-02 18:00:00`, endAt: `2026-12-02 18:00:00` },
	],
	createdBy: { id: 12, name: `Maya Healing`, login: `maya` },
	place: {
		title: `Sacred Space Ubud`,
		slug: `sacred-space-ubud`,
		districtName: `Ubud`,
		instagram: `@sacredspaceubud`,
		location: {
			lat: -8.5,
			lng: 115.26,
			address: `Jl. Raya Sanggingan, Ubud, Bali`,
		},
	},
	media: {
		content: [
			{
				originalUrl: `https://static.bali.live/uploads/1/cover.webp`,
				previewUrl: `https://static.bali.live/uploads/1/cover-preview.jpg`,
			},
		],
	},
	desktopPreview: {
		previewUrl: `https://static.bali.live/uploads/1/cover-preview.jpg`,
	},
};

describe(`mapBaliLiveEvent`, () => {
	it(`maps detail payloads into occurrence events`, () => {
		const rangeStart = new Date(`2026-11-01T00:00:00+08:00`);
		const rangeEnd = new Date(`2027-02-01T00:00:00+08:00`);
		const mapped = mapBaliLiveEvent({
			event: detail,
			rangeStart,
			rangeEnd,
			nowMs: Date.parse(`2026-11-20T00:00:00+08:00`),
		});

		expect(mapped).toHaveLength(2);
		expect(mapped[0]).toMatchObject({
			name: `Cacao Ceremony & Sound Healing`,
			startAt: `2026-12-01T18:00:00+08:00`,
			endAt: `2026-12-01T20:00:00+08:00`,
			price: `Free`,
			host: `Maya Healing`,
			hostLink: `https://bali.live/places/sacred-space-ubud`,
			sourceUrl: `https://bali.live/events/cacao-ceremony-sound-healing`,
			source: `balilive`,
			timezone: `Asia/Makassar`,
			latitude: -8.5,
			longitude: 115.26,
			tags: [`Wellness`, `Music`],
		});
		expect(mapped[0]?.address).toEqual([
			`Sacred Space Ubud`,
			`Jl. Raya Sanggingan, Ubud, Bali`,
		]);
		expect(mapped[0]?.description).toContain(`cacao and sound healing`);
		expect(mapped[0]?.imageUrls[0]).toBe(`https://static.bali.live/uploads/1/cover.webp`);
		expect(mapped[0]?.contact).toEqual(
			expect.arrayContaining([
				`https://www.instagram.com/sacredspaceubud`,
				`https://api.whatsapp.com/send?phone=6281138219512`,
			]),
		);
		expect(mapped[1]?.startAt).toBe(`2026-12-02T18:00:00+08:00`);
		expect(mapped[1]?.endAt).toBeUndefined();
	});

	it(`skips generic admin hosts and empty titles`, () => {
		expect(getHost({ ...detail, createdBy: { name: `admin` } })).toBeUndefined();
		expect(getName({ ...detail, title: `  ` })).toBeUndefined();
		expect(
			mapBaliLiveEvent({
				event: { ...detail, title: `Club Night Party Only` },
				rangeStart: new Date(`2026-11-01T00:00:00+08:00`),
				rangeEnd: new Date(`2027-02-01T00:00:00+08:00`),
				nowMs: 0,
			}),
		).toEqual([]);
	});
});

describe(`field helpers`, () => {
	it(`parses wall times in Bali timezone`, () => {
		expect(wallToIso(`2026-11-25 23:59:59`)).toBe(`2026-11-25T23:59:00+08:00`);
	});

	it(`builds address, price, tags, and images`, () => {
		expect(getAddress(detail)).toEqual([
			`Sacred Space Ubud`,
			`Jl. Raya Sanggingan, Ubud, Bali`,
		]);
		expect(getPrice(detail)).toBe(`Free`);
		expect(getPrice({ ...detail, entry: `paid` })).toBe(`Paid`);
		expect(getPrice({ ...detail, entry: `all` })).toBeUndefined();
		expect(getTags(detail)).toEqual([`Wellness`, `Music`]);
		expect(getImageUrls(detail)).toContain(`https://static.bali.live/uploads/1/cover.webp`);
		expect(getDescription(detail)).toContain(`<p>`);
		expect(getContact(detail)).toHaveLength(2);
	});

	it(`ignores scrape-websites runner flags for --limit`, () => {
		expect(parseCliArgs([`balilive`, `--clean`, `--limit`, `5`]).limit).toBe(5);
		expect(parseCliArgs([`--dry-run`, `--limit=2`]).limit).toBe(2);
	});

	it(`requires whitelist words`, () => {
		expect(passesNameLists(`Cacao Ceremony`)).toBe(true);
		expect(passesNameLists(`Football Match Final`)).toBe(false);
	});
});
