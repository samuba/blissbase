import { describe, expect, it } from "vitest";
import {
	getImageUrls,
	isUpcomingStart,
	parseEventDetail,
	parseListPage,
	stableImageUrl,
} from "./scrape-eventbyindonesia.ts";
import { stableImageCacheOriginalUrl } from "./imageCacheLookup.ts";

describe(`parseListPage`, () => {
	it(`reads Bali listings and meta`, () => {
		const page = parseListPage(
			{
				status: `success`,
				data: {
					data: [
						{ name: `Pemuteran Bay Festival 2026`, slug: `pemuteran-bay-festival-2026` },
						{ name: ``, slug: `missing-name` },
						{ name: `No Slug`, slug: `` },
					],
					meta: { current_page: 1, last_page: 1, total: 1 },
				},
			},
			1,
		);
		expect(page).toEqual({
			currentPage: 1,
			lastPage: 1,
			total: 1,
			listings: [{ name: `Pemuteran Bay Festival 2026`, slug: `pemuteran-bay-festival-2026` }],
		});
	});

	it(`rejects a mismatched page number`, () => {
		expect(() =>
			parseListPage(
				{
					data: {
						data: [],
						meta: { current_page: 2, last_page: 2, total: 0 },
					},
				},
				1,
			),
		).toThrow(/came back as 2/);
	});
});

describe(`parseEventDetail`, () => {
	it(`maps detail fields used by the scraper`, () => {
		const detail = parseEventDetail({
			data: {
				name: `Pesta Kesenian Bali (PKB)`,
				name_en: `The Bali Arts Festival (PKB)`,
				slug: `pesta-kesenian-bali-pkb`,
				start_event: `2026-06-13`,
				end_event: `2026-07-11`,
				start_time: `12:00`,
				end_time: `12:00`,
				city_name: `Kota Denpasar`,
				province_name: `Bali`,
				description: `<p>Deskripsi ID</p>`,
				description_en: `<p>English description</p>`,
				payment: `FREE`,
				instagram_link: `@eventbyid`,
				more_info_link: `https://example.com/info`,
				ticket_links: [{ url: `https://example.com/tickets` }],
				latitude: null,
				longitude: null,
				image: `https://cdn.example/banner.jpg`,
				thumbnail_url: `https://cdn.example/thumb.jpg`,
				images: [{ url: `https://cdn.example/gallery.jpg` }],
				event_category: `art-culture`,
				event_type: `karisma-event-nusantara`,
				partnerships: [{ name: `Kemenpar` }],
			},
		});

		expect(detail).toMatchObject({
			name: `Pesta Kesenian Bali (PKB)`,
			nameEn: `The Bali Arts Festival (PKB)`,
			slug: `pesta-kesenian-bali-pkb`,
			startEvent: `2026-06-13`,
			endEvent: `2026-07-11`,
			startTime: `12:00`,
			cityName: `Kota Denpasar`,
			provinceName: `Bali`,
			descriptionHtml: `<p>English description</p>`,
			payment: `FREE`,
			instagramLink: `@eventbyid`,
			moreInfoLink: `https://example.com/info`,
			ticketLinks: [`https://example.com/tickets`],
			image: `https://cdn.example/banner.jpg`,
			galleryImages: [`https://cdn.example/gallery.jpg`],
			eventCategory: `art-culture`,
			partnerships: [`Kemenpar`],
		});
	});

	it(`returns undefined without a slug`, () => {
		expect(parseEventDetail({ data: { name: `x` } })).toBeUndefined();
	});
});

describe(`isUpcomingStart`, () => {
	it(`keeps starts within the grace window`, () => {
		const now = Date.parse(`2026-11-24T12:00:00+08:00`);
		expect(isUpcomingStart({ startAt: `2026-11-24T08:00:00+08:00`, now })).toBe(true);
		expect(isUpcomingStart({ startAt: `2026-11-20T08:00:00+08:00`, now })).toBe(false);
	});
});

describe(`getImageUrls`, () => {
	it(`keeps banner plus up to two gallery images and skips thumbnail dupes`, () => {
		const signed = (path: string) =>
			`https://api-event.kemenpar.go.id/eventbyid/${path}?X-Amz-Expires=3600&X-Amz-Signature=abc`;
		const detail = parseEventDetail({
			data: {
				name: `Fest`,
				slug: `fest`,
				start_event: `2026-11-27`,
				image: signed(`events/banner/a/cover.jpeg`),
				thumbnail_url: signed(`thumbnails/800/events/banner/a/cover.jpeg`),
				images: [
					{ url: signed(`events/banner/a/cover.jpeg`) },
					{ url: signed(`events/banner/a/g1.jpeg`) },
					{ url: signed(`events/banner/a/g2.jpeg`) },
					{ url: signed(`events/banner/a/g3.jpeg`) },
				],
			},
		});
		expect(detail).toBeTruthy();
		const urls = getImageUrls(detail!);
		expect(urls).toHaveLength(3);
		expect(urls.map(stableImageUrl)).toEqual([
			`https://api-event.kemenpar.go.id/eventbyid/events/banner/a/cover.jpeg`,
			`https://api-event.kemenpar.go.id/eventbyid/events/banner/a/g1.jpeg`,
			`https://api-event.kemenpar.go.id/eventbyid/events/banner/a/g2.jpeg`,
		]);
	});
});

describe(`stableImageUrl / stableImageCacheOriginalUrl`, () => {
	it(`strips Amz signature query params`, () => {
		const signed =
			`https://api-event.kemenpar.go.id/eventbyid/events/banner/a.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=3600&X-Amz-Signature=deadbeef`;
		expect(stableImageUrl(signed)).toBe(
			`https://api-event.kemenpar.go.id/eventbyid/events/banner/a.jpg`,
		);
		expect(stableImageCacheOriginalUrl(signed)).toBe(
			`https://api-event.kemenpar.go.id/eventbyid/events/banner/a.jpg`,
		);
		expect(stableImageCacheOriginalUrl(`https://cdn.example/ok.webp`)).toBe(`https://cdn.example/ok.webp`);
	});
});
