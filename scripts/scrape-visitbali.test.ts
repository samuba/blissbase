import { describe, expect, it } from "vitest";
import {
	WebsiteScraper,
	combineDateAndTime,
	isUpcomingEvent,
	parseEnglishDate,
	parseListingEventUrls,
	parseSitemapEventUrls,
	parseTimes,
} from "./scrape-visitbali.ts";
import { dateToIsoStr } from "./common.ts";

const DETAIL_HTML = `
<div class="event-detail__body-content">
  <span>Free</span>
  <h1>Suwat Water Garden Festival</h1>
  <div class="event-detail__body-sidebar">
    <h4>DATE AND TIME</h4>
    <span>Start</span>
    <p>Monday, 30 December 2019</p>
    <span>End </span>
    <p>Thursday, 02 January 2020</p>
    <span>Times</span>
    <p>09:30 AM - 06:30 PM</p>
    <address>Suwat Waterfall, Gianyar, Bali, Indonesia</address>
  </div>
  <h3>Details</h3>
  <p>Unite with Water.</p>
</div>
`;

const UPCOMING_DETAIL_HTML = `
<div class="event-detail__body-content">
  <h1>Future Festival</h1>
  <div class="event-detail__body-sidebar">
    <span>Start</span>
    <p>Friday, 05 December 2026</p>
    <span>End </span>
    <p>Sunday, 07 December 2026</p>
    <span>Times</span>
    <p>10:00 AM - 08:00 PM</p>
    <address>Ubud, Bali</address>
  </div>
</div>
`;

const LISTING_HTML = `
<div class="home-events__card"><a href="/events/details/future-festival?x=1">Future</a></div>
<div class="home-events__card"><a href="https://visitbali.id/events/details/future-festival/">dup</a></div>
<a href="/events/details/orphan">not a card</a>
`;

describe(`parseEnglishDate / combineDateAndTime`, () => {
	it(`parses VisitBali sidebar dates in Asia/Makassar`, () => {
		expect(parseEnglishDate(`Monday, 30 December 2019`)).toEqual({ year: 2019, month: 11, day: 30 });
		expect(combineDateAndTime({ dateText: `Monday, 30 December 2019`, time: { hour: 9, minute: 30 } })).toBe(
			dateToIsoStr(2019, 11, 30, 9, 30, `Asia/Makassar`, true),
		);
	});
});

describe(`parseTimes`, () => {
	it(`parses AM/PM ranges`, () => {
		expect(parseTimes(`09:30 AM - 06:30 PM`)).toEqual({
			startTime: { hour: 9, minute: 30 },
			endTime: { hour: 18, minute: 30 },
		});
	});
});

describe(`WebsiteScraper schedule extraction`, () => {
	it(`reads Start/End/Times from the sidebar (including trailing space on End)`, () => {
		const scraper = new WebsiteScraper();
		expect(scraper.extractName(DETAIL_HTML)).toBe(`Suwat Water Garden Festival`);
		expect(scraper.extractStartAt(DETAIL_HTML)).toBe(
			dateToIsoStr(2019, 11, 30, 9, 30, `Asia/Makassar`, true),
		);
		expect(scraper.extractEndAt(DETAIL_HTML)).toBe(
			dateToIsoStr(2020, 0, 2, 18, 30, `Asia/Makassar`, true),
		);
	});

	it(`keeps a multi-day upcoming festival via endAt`, () => {
		const scraper = new WebsiteScraper();
		const startAt = scraper.extractStartAt(UPCOMING_DETAIL_HTML)!;
		const endAt = scraper.extractEndAt(UPCOMING_DETAIL_HTML);
		const now = Date.parse(`2026-12-06T12:00:00+08:00`);
		expect(isUpcomingEvent({ startAt, endAt, now })).toBe(true);
		expect(isUpcomingEvent({ startAt, endAt: undefined, now })).toBe(false);
	});
});

describe(`isUpcomingEvent`, () => {
	it(`uses endAt when present, otherwise startAt, with grace`, () => {
		const now = Date.parse(`2026-11-25T12:00:00+08:00`);
		expect(
			isUpcomingEvent({
				startAt: `2026-11-20T09:00:00+08:00`,
				endAt: `2026-11-26T18:00:00+08:00`,
				now,
			}),
		).toBe(true);
		expect(
			isUpcomingEvent({
				startAt: `2026-11-20T09:00:00+08:00`,
				endAt: `2026-11-21T18:00:00+08:00`,
				now,
			}),
		).toBe(false);
		expect(isUpcomingEvent({ startAt: `2026-11-25T10:00:00+08:00`, now })).toBe(true);
		expect(isUpcomingEvent({ startAt: `2026-11-24T10:00:00+08:00`, now })).toBe(false);
	});
});

describe(`listing / sitemap url parsers`, () => {
	it(`dedupes listing cards`, () => {
		expect(parseListingEventUrls(LISTING_HTML)).toEqual([
			`https://visitbali.id/events/details/future-festival`,
		]);
	});

	it(`reads sitemap locs under /events/details/`, () => {
		const xml = `
			<urlset>
				<url><loc>https://visitbali.id/events/details/a</loc></url>
				<url><loc>https://visitbali.id/news/post/x</loc></url>
			</urlset>
		`;
		expect(parseSitemapEventUrls(xml)).toEqual([`https://visitbali.id/events/details/a`]);
	});

	it(`treats an empty listing as zero urls`, () => {
		expect(parseListingEventUrls(`<div class="col-sm-12 text-center mt-3"><strong>No results found!</strong></div>`)).toEqual(
			[],
		);
	});
});
