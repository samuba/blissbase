import { describe, expect, it, vi } from "vitest";
import {
	addressLinesFromHtml,
	articlePassesNameLists,
	formatIdr,
	getAddress,
	getEndAt,
	getName,
	getSourceUrl,
	getStartAt,
	getTags,
	isUpcomingStart,
	mapArticle,
	parseCliArgs,
	parseLatLong,
	passesNameLists,
	wallTimeToIso,
} from "./scrape-whatsnewindonesia.ts";

vi.mock(`../src/lib/server/google.script.ts`, () => ({
	geocodeAddressCached: vi.fn(async () => null),
}));

const article = {
	id: 15048,
	title: `Party Animals with Damian Lazarus`,
	sub_title: `Party Animals continues in November with Damian Lazarus`,
	slug: `party-animals-with-damian-lazarus`,
	slug_city: `bali`,
	name_city: `Bali`,
	name_country: `Indonesia`,
	category_name: `Nightlife`,
	featured_image_url: `uploads/cover.webp`,
	meta_data: {
		meta_description: `Party Animals continues in November with Damian Lazarus`,
		start_date: `2026-11-25`,
		end_date: `2026-11-25`,
		start_time: `20:00`,
		end_time: `23:59`,
		whole_day: 0,
	},
};

const detailHtml = `
<html><body>
<link rel="canonical" href="https://whatsnewindonesia.com/bali/party-animals-with-damian-lazarus"/>
<h1>Party Animals with Damian Lazarus</h1>
<div class="content-wrapper mb-8">
<p>Party Animals continues in November with Damian Lazarus</p>
<p>Wed 25 November, let instinct take over.</p>
<p>Tickets &amp; tables at <a href="https://zumanabali.com/">ZumanaBali.com</a></p>
<p>Sunset Bay Kuta<br>Jl. Kartika Plaza No.2, Kuta, Bali 80361<br>Phone: +6281130110111<br><a href="https://zumanabali.com/">Website</a></p>
</div>
</body></html>
`;

describe(`passesNameLists`, () => {
	it(`keeps a whitelist title and drops a blacklist title`, () => {
		expect(passesNameLists(`Silent Retreat Bali`)).toBe(true);
		expect(passesNameLists(`Bali Pub Crawl Seminyak`)).toBe(false);
		expect(passesNameLists(``)).toBe(false);
		expect(passesNameLists(undefined)).toBe(false);
	});

	it(`filters on title only — category labels are ignored`, () => {
		// Category strings contain whitelist words (`concert`, `wellness`) and must not be consulted.
		expect(passesNameLists(`Music, Concerts and Festivals`)).toBe(true);
		expect(
			articlePassesNameLists({
				title: `BTS Confirms Jakarta Dates for Long-Awaited World Tour 2026`,
			}),
		).toBe(false);
		expect(
			articlePassesNameLists({
				title: `NusantaRun Chapter 14`,
			}),
		).toBe(false);
		expect(
			articlePassesNameLists({
				title: `A Journey Inward: Four Seasons Resort Bali at Sayan Launches Transformative Silent Retreat Led by Resident Healers`,
			}),
		).toBe(true);
	});
});

describe(`wallTimeToIso`, () => {
	it(`builds a Bali wall-clock ISO from date and time`, () => {
		expect(
			wallTimeToIso({
				date: `2026-11-25`,
				time: `20:00`,
				timezone: `Asia/Makassar`,
			}),
		).toBe(`2026-11-25T20:00:00+08:00`);
	});

	it(`falls back to event_date unix when start_date is missing`, () => {
		const iso = wallTimeToIso({
			timezone: `Asia/Jakarta`,
			eventDateUnix: 1730000000,
		});
		expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/);
	});
});

describe(`article field helpers`, () => {
	it(`reads name, dates, url, tags, and image`, () => {
		expect(getName(article)).toBe(`Party Animals with Damian Lazarus`);
		expect(getStartAt(article)).toBe(`2026-11-25T20:00:00+08:00`);
		expect(getEndAt(article)).toBe(`2026-11-25T23:59:00+08:00`);
		expect(getSourceUrl(article)).toBe(
			`https://whatsnewindonesia.com/bali/party-animals-with-damian-lazarus`,
		);
		expect(getTags(article)).toEqual([`Nightlife`]);
	});

	it(`drops an end that is not after start`, () => {
		expect(
			getEndAt({
				...article,
				meta_data: {
					...article.meta_data,
					end_date: `2026-11-24`,
					end_time: `10:00`,
				},
			}),
		).toBeUndefined();
	});

	it(`parses address HTML and IDR prices`, () => {
		expect(
			addressLinesFromHtml(
				`<p><strong>Sofitel Bali</strong><br>ITDC Tourism Complex<br>Phone: +62 361 8492888</p>`,
			),
		).toEqual([`Sofitel Bali`, `ITDC Tourism Complex`]);
		expect(formatIdr(450000)).toBe(`IDR 450,000`);
		expect(formatIdr(0)).toBe(`Free`);
		expect(parseLatLong(`-8.664195446798933, 115.13841058465614`)).toEqual({
			lat: -8.664195446798933,
			lng: 115.13841058465614,
		});
	});

	it(`falls back to city lines when detail has no venue block`, () => {
		expect(getAddress({ article, html: `<div class="content-wrapper"><p>Hello</p></div>` })).toEqual([
			`Bali`,
			`Indonesia`,
		]);
	});
});

describe(`mapArticle`, () => {
	it(`maps listing + detail html onto a scraped event`, async () => {
		const mapped = await mapArticle({
			article,
			html: detailHtml,
			sourceUrl: `https://whatsnewindonesia.com/bali/party-animals-with-damian-lazarus`,
		});

		expect(mapped).toMatchObject({
			name: `Party Animals with Damian Lazarus`,
			startAt: `2026-11-25T20:00:00+08:00`,
			endAt: `2026-11-25T23:59:00+08:00`,
			timezone: `Asia/Makassar`,
			address: [`Sunset Bay Kuta`, `Jl. Kartika Plaza No.2, Kuta, Bali 80361`],
			tags: [`Nightlife`],
			source: `whatsnewindonesia`,
			sourceUrl: `https://whatsnewindonesia.com/bali/party-animals-with-damian-lazarus`,
			latitude: -8.4095178,
			longitude: 115.188916,
		});
		expect(mapped?.description).toContain(`Party Animals continues`);
		expect(mapped?.imageUrls[0]).toContain(`uploads/cover.webp`);
		// Venue marketing sites are not contacts; phones from the address block are.
		expect(mapped?.contact.some((value) => value.includes(`zumanabali.com`))).toBe(false);
		expect(mapped?.contact.some((value) => value.startsWith(`tel:`))).toBe(true);
	});
});

describe(`isUpcomingStart / parseCliArgs`, () => {
	it(`keeps starts within the grace window`, () => {
		const now = Date.parse(`2026-11-25T12:00:00+08:00`);
		expect(isUpcomingStart({ startAt: `2026-11-25T20:00:00+08:00`, now })).toBe(true);
		expect(isUpcomingStart({ startAt: `2026-11-20T20:00:00+08:00`, now })).toBe(false);
	});

	it(`parses --limit`, () => {
		expect(parseCliArgs([`--limit=5`])).toEqual({ limit: 5 });
		expect(parseCliArgs([])).toEqual({ limit: undefined });
	});
});
