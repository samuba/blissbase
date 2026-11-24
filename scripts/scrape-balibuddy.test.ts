import { describe, expect, it } from "vitest";
import {
	getAddress,
	getContact,
	getCoordinates,
	getEndAt,
	getHost,
	getName,
	getOccurrenceDate,
	getPrice,
	getSourceUrl,
	getStartAt,
	getTags,
	mapListing,
	parseAmPmTime,
	parseListingPage,
} from "./scrape-balibuddy.ts";

const sampleListing = {
	id: `13103`,
	title: `  DAMIAN LAZARUS  `,
	content: `<p><b>Zumana Beach Club Presents</b></p><p>DAMIAN LAZARUS</p>`,
	link: `https://balibuddy.app/listing/damian-lazarus-2/`,
	phone_number: ``,
	get_tickets: `https://megatix.co.id/white-label/damianlazarus-2511?utm_source=balibuddy`,
	listing_type: `event`,
	logo: `https://balibuddy.app/wp-content/uploads/2026/11/logo-zumana-bali.jpg`,
	background_image: `https://balibuddy.app/wp-content/uploads/2026/11/megatix-73764-damian-lazarus.jpg`,
	gallery: [],
	categories: [`Music and Nightlife`],
	tags: [{ name: `Music` }],
	start_time: `04:00:00 PM`,
	end_time: `11:59:00 PM`,
	next_event_date: [`2026-11-25`],
	fromPrice: `400000`,
	location: [
		{
			address: `Zumana Bali, Jl. Kartika Plaza No.2, Kuta 80361 Indonesia`,
			lat: `-8.72755`,
			lng: `115.16729`,
		},
	],
	business_title: { name: `Zumana Bali`, id: 12992 },
	megatix_source: {
		event_id: `73764`,
		slug: `damianlazarus-2511`,
		promoter: `Zumana Bali`,
		ticket_url: `https://megatix.co.id/events/damianlazarus-2511`,
	},
};

describe(`parseAmPmTime`, () => {
	it(`parses 12-hour Bali Buddy times`, () => {
		expect(parseAmPmTime(`04:00:00 PM`)).toEqual({ hour: 16, minute: 0 });
		expect(parseAmPmTime(`12:00:00 AM`)).toEqual({ hour: 0, minute: 0 });
		expect(parseAmPmTime(`12:30:00 PM`)).toEqual({ hour: 12, minute: 30 });
		expect(parseAmPmTime(`7:00 PM`)).toEqual({ hour: 19, minute: 0 });
		expect(parseAmPmTime(``)).toBeUndefined();
		expect(parseAmPmTime(`16:00`)).toBeUndefined();
	});
});

describe(`field getters`, () => {
	it(`reads occurrence from next_event_date, not listing publish date`, () => {
		expect(getOccurrenceDate(sampleListing)).toEqual({ year: 2026, month: 11, day: 25 });
		expect(getStartAt(sampleListing)).toBe(`2026-11-25T16:00:00+08:00`);
		expect(getEndAt(sampleListing)).toBe(`2026-11-25T23:59:00+08:00`);
	});

	it(`rolls endAt to the next day when end is not after start`, () => {
		const overnight = {
			...sampleListing,
			start_time: `10:00:00 PM`,
			end_time: `02:00:00 AM`,
		};
		expect(getEndAt(overnight)).toBe(`2026-11-26T02:00:00+08:00`);
	});

	it(`maps address, price, host, tags, contact, coords`, () => {
		expect(getName(sampleListing)).toBe(`DAMIAN LAZARUS`);
		expect(getAddress(sampleListing)).toEqual([
			`Zumana Bali`,
			`Jl. Kartika Plaza No.2`,
			`Kuta 80361 Indonesia`,
		]);
		expect(getPrice(sampleListing)).toBe(`Rp 400.000`);
		expect(getHost(sampleListing)).toBe(`Zumana Bali`);
		expect(getTags(sampleListing)).toEqual([`Music and Nightlife`, `Music`]);
		expect(getContact(sampleListing)).toEqual([
			`https://megatix.co.id/white-label/damianlazarus-2511?utm_source=balibuddy`,
		]);
		expect(getCoordinates(sampleListing)).toEqual({ lat: -8.72755, lng: 115.16729 });
		expect(getSourceUrl(sampleListing)).toBe(`https://balibuddy.app/listing/damian-lazarus-2/`);
	});
});

describe(`mapListing`, () => {
	it(`builds a ScrapedEvent with Asia/Makassar timezone`, () => {
		const event = mapListing(sampleListing);
		expect(event?.source).toBe(`balibuddy`);
		expect(event?.timezone).toBe(`Asia/Makassar`);
		expect(event?.imageUrls[0]).toContain(`megatix-73764`);
		expect(event?.description).toContain(`Zumana Beach Club`);
	});

	it(`returns undefined without a source URL`, () => {
		expect(mapListing({ ...sampleListing, link: `` })).toBeUndefined();
	});
});

describe(`parseListingPage`, () => {
	it(`parses a successful page payload`, () => {
		const page = parseListingPage(
			{
				success: true,
				data: [sampleListing],
				total_count: 1,
				total_pages: 1,
				current_page: 1,
				has_more: false,
			},
			1,
		);
		expect(page.listings).toHaveLength(1);
		expect(page.listings[0]?.title).toBe(`DAMIAN LAZARUS`);
		expect(page.hasMore).toBe(false);
	});

	it(`throws when data is missing`, () => {
		expect(() => parseListingPage({ success: true }, 1)).toThrow(/no data array/);
	});
});
