import { describe, expect, it } from "vitest";
import {
	getAddress,
	getEndAt,
	getName,
	getPrice,
	getStartAt,
	getTags,
	getVenue,
	isUpcoming,
	parseCliArgs,
	parseDateRangeText,
	parseTimeRange,
	passesNameLists,
} from "./scrape-nowbali.ts";

const DETAIL_HTML = `
<article class="upcoming-events">
  <div class="heading-font"><a href="https://www.nowbali.co.id/event-category/experience/">Experience</a></div>
  <div class="post-entry">
    <h1>Pasar Thanksgiving Pererenan: A Neighbourhood Feast</h1>
    <div class="fw-bold fs-6">28 November 2026 - 28 November 2026</div>
    <div class="pb-3 fs-6">Noema Resort Pererenan</div>
    <p>Gather from <strong>2pm to 9pm</strong> for food and music. Open to the public.</p>
    <p><strong>Noema Resort Pererenan</strong><br />
    Jl. Pantai Pererenan No. 126, Pererenan<br />
    +62 811 3913 939<br />
    <a href="https://noemapererenan.jhlcollections.com/">noemapererenan.jhlcollections.com</a></p>
  </div>
</article>
`;

const MULTI_DAY_HTML = `
<article class="upcoming-events">
  <div class="heading-font"><a href="https://www.nowbali.co.id/event-category/art-culture/">Art &amp; Culture</a></div>
  <div class="post-entry">
    <h1>'Alchemy of the Soul' Art Exhibition at INDUS</h1>
    <div class="fw-bold fs-6">29 October 2026 - 30 November 2026</div>
    <div class="pb-3 fs-6">INDUS Art Space</div>
    <p>• 11am – 10pm daily<br />• Free to View</p>
    <p><strong>INDUS Art Space</strong><br />
    Jalan Raya Sanggingan, Ubud, Bali<br />
    +62 82138773739<br />
    <a href="http://indusbali.com">indusbali.com</a></p>
  </div>
</article>
`;

describe(`scrape-nowbali parsers`, () => {
	it(`parses English date ranges`, () => {
		expect(parseDateRangeText(`28 November 2026 - 28 November 2026`)).toEqual({
			start: { year: 2026, month: 11, day: 28 },
			end: { year: 2026, month: 11, day: 28 },
		});
		expect(parseDateRangeText(`29 October 2026 - 30 November 2026`)).toEqual({
			start: { year: 2026, month: 10, day: 29 },
			end: { year: 2026, month: 11, day: 30 },
		});
	});

	it(`parses am/pm time ranges`, () => {
		expect(parseTimeRange(`from 2pm to 9pm`)).toEqual({
			start: { hour: 14, minute: 0 },
			end: { hour: 21, minute: 0 },
		});
		expect(parseTimeRange(`11am – 10pm daily`)).toEqual({
			start: { hour: 11, minute: 0 },
			end: { hour: 22, minute: 0 },
		});
		expect(
			parseTimeRange(
				`Pilates (9am – 10am). Registration starts at 7am, while the event kicks off at 9am until 5.30pm.`,
			),
		).toEqual({
			start: { hour: 9, minute: 0 },
			end: { hour: 17, minute: 30 },
		});
	});

	it(`extracts fields from a single-day detail page`, () => {
		expect(getName(DETAIL_HTML)).toBe(`Pasar Thanksgiving Pererenan: A Neighbourhood Feast`);
		expect(getVenue(DETAIL_HTML)).toBe(`Noema Resort Pererenan`);
		expect(getStartAt(DETAIL_HTML)).toBe(`2026-11-28T14:00:00+08:00`);
		expect(getEndAt(DETAIL_HTML)).toBe(`2026-11-28T21:00:00+08:00`);
		expect(getAddress(DETAIL_HTML)).toEqual([
			`Noema Resort Pererenan`,
			`Jl. Pantai Pererenan No. 126, Pererenan`,
			`Bali`,
		]);
		expect(getTags(DETAIL_HTML)).toEqual([`Experience`]);
	});

	it(`extracts multi-day exhibition fields and free price`, () => {
		expect(getStartAt(MULTI_DAY_HTML)).toBe(`2026-10-29T11:00:00+08:00`);
		expect(getEndAt(MULTI_DAY_HTML)).toBe(`2026-11-30T22:00:00+08:00`);
		expect(getPrice(MULTI_DAY_HTML)).toBe(`Free`);
		expect(getTags(MULTI_DAY_HTML)).toEqual([`Art & Culture`]);
	});

	it(`prefers ticket prices and ignores raised IDR amounts`, () => {
		const priced = `
			<article><div class="post-entry">
				<p>Last year raised IDR 500 million for charity.</p>
				<p>Tickets are priced at IDR 1,500,000++ per person.</p>
			</div></article>`;
		expect(getPrice(priced)).toBe(`IDR 1,500,000++ per person`);
	});

	it(`only treats admission-shaped free phrases as Free`, () => {
		expect(
			getPrice(`
				<article><div class="post-entry">
					<p>• Free to View</p>
				</div></article>`),
		).toBe(`Free`);
		expect(
			getPrice(`
				<article><div class="post-entry">
					<p>Admission is free. No charge for children.</p>
				</div></article>`),
		).toBe(`Free`);
		expect(
			getPrice(`
				<article><div class="post-entry">
					<p>100 guests will be invited to share a complimentary dinner.</p>
					<p>Feel free to explore the market. Powered by Font Awesome Free.</p>
				</div></article>`),
		).toBeUndefined();
		expect(
			getPrice(`
				<article><div class="post-entry">
					<p>Complimentary admission for hotel guests.</p>
				</div></article>`),
		).toBe(`Free`);
	});

	it(`keeps upcoming events that are still running`, () => {
		expect(
			isUpcoming({
				startAt: `2026-10-01T00:00:00+08:00`,
				endAt: `2026-12-01T23:59:00+08:00`,
				now: Date.parse(`2026-11-15T00:00:00+08:00`),
			}),
		).toBe(true);
		expect(
			isUpcoming({
				startAt: `2025-01-01T00:00:00+08:00`,
				endAt: `2025-01-02T00:00:00+08:00`,
				now: Date.parse(`2026-11-15T00:00:00+08:00`),
			}),
		).toBe(false);
	});

	it(`parses --limit from argv`, () => {
		expect(parseCliArgs([`--limit`, `7`, `--dry-run`])).toEqual({ limit: 7, files: [] });
		expect(parseCliArgs([`--limit=3`, `fixture.html`])).toEqual({
			limit: 3,
			files: [`fixture.html`],
		});
	});

	it(`requires whitelist words in event names`, () => {
		expect(passesNameLists(`Celebrate Wellness 2026`)).toBe(true);
		expect(passesNameLists(`Random Beach Club Opening`)).toBe(false);
	});
});
