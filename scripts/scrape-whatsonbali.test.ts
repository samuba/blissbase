import { describe, expect, it, vi } from "vitest";
import {
	expandOccurrences,
	getAddress,
	getDescription,
	getEndAt,
	getHost,
	getImageUrls,
	getName,
	getPrice,
	getRecurrence,
	getStartAt,
	getTags,
	parseCliArgs,
	parseListing,
} from "./scrape-whatsonbali.ts";

vi.mock(`../src/lib/server/google.script.ts`, () => ({
	geocodeAddressCached: vi.fn(async () => null),
}));

const detailHtml = `<!doctype html><html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"Trauma Release Training","description":"A somatic training.","url":"https://whatsonbali.com/events/trauma-release-training/","image":"https://whatsonbali.com/wp-content/uploads/2026/11/poster-1024x576.png","startDate":"2026-12-06T12:00:00+08:00","endDate":"2026-12-11T12:00:00+08:00","location":{"@type":"Place","name":"Surya Kembar Villa","address":"Jl. Cempaka, Banjar Kumbuh, Mas, Kecamatan Ubud, Kabupaten Gianyar, Bali 80571"}}</script>
</head><body>
<section class="wob-hero-d"><span class="wob-pill">Wellness &amp; Yoga</span><h1>Trauma Release Training</h1><div class="wob-hero-d__meta">Ubud</div></section>
<div class="wob-org"><strong>Bali Retreat Partners</strong></div>
<section class="wob-sec"><div class="wob-rich"><p>Trauma Release Training is immersive.</p></div></section>
<aside id="wob-buy"><div class="wob-buy"><h3>Tickets</h3><b class="is-free">Free entry</b><a data-wob-out href="https://www.kachenka.org/trauma-release-training">Visit</a></div></aside>
</body></html>`;

const recurringHtml = `<!doctype html><html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"Acoustic Wednesdays at Single Fin","url":"https://whatsonbali.com/events/acoustic-wednesdays-at-single-fin/","startDate":"2026-11-25T10:00:00+08:00","endDate":"2026-11-26T00:00:00+08:00","location":{"@type":"Place","name":"Single Fin","address":"Jl. Mamo, Pecatu"}}</script>
</head><body>
<ul class="wob-evbox__rows"><li><span>Repeats</span><b>Every Wednesday</b></li></ul>
</body></html>`;

describe(`parseCliArgs`, () => {
	it(`parses --limit and ignores runner flags`, () => {
		expect(parseCliArgs([`whatsonbali`, `--clean`, `--limit`, `4`, `a.html`])).toEqual({
			limit: 4,
			files: [`whatsonbali`, `a.html`],
		});
		expect(parseCliArgs([`--dry-run`, `--limit=2`, `--log-dir`, `scrape-logs`])).toEqual({
			limit: 2,
			files: [],
		});
	});
});

describe(`field extractors`, () => {
	it(`reads Event JSON-LD and page fields`, () => {
		expect(getName(detailHtml)).toBe(`Trauma Release Training`);
		expect(getStartAt(detailHtml)).toBe(`2026-12-06T12:00:00+08:00`);
		expect(getEndAt(detailHtml)).toBe(`2026-12-11T12:00:00+08:00`);
		expect(getHost(detailHtml)).toBe(`Bali Retreat Partners`);
		expect(getPrice(detailHtml)).toBe(`Free entry`);
		expect(getTags(detailHtml)).toEqual([`Wellness & Yoga`]);
		expect(getDescription(detailHtml)).toContain(`Trauma Release Training is immersive`);
		expect(getAddress(detailHtml)[0]).toBe(`Surya Kembar Villa`);
		expect(getAddress(detailHtml).join(` `)).toMatch(/Ubud/);
		expect(getImageUrls(detailHtml)[0]).toBe(
			`https://whatsonbali.com/wp-content/uploads/2026/11/poster.png`,
		);
	});

	it(`reads recurrence from the repeats row`, () => {
		expect(getRecurrence(recurringHtml)).toBe(`Every Wednesday`);
	});

	it(`keeps category tags and omits areaName`, () => {
		expect(
			getTags(detailHtml, {
				link: `https://whatsonbali.com/events/trauma-release-training/`,
				categoryName: `Wellness & Yoga`,
				areaName: `Ubud`,
			}),
		).toEqual([`Wellness & Yoga`]);
	});
});

describe(`expandOccurrences`, () => {
	it(`keeps a one-off event as a single occurrence`, () => {
		expect(
			expandOccurrences({
				startAt: `2026-12-06T12:00:00+08:00`,
				endAt: `2026-12-11T12:00:00+08:00`,
				recurrence: null,
				daysAhead: 90,
			}),
		).toEqual([
			{
				startAt: `2026-12-06T12:00:00+08:00`,
				endAt: `2026-12-11T12:00:00+08:00`,
			},
		]);
	});

	it(`expands weekly recurrence`, () => {
		const occurrences = expandOccurrences({
			startAt: `2026-11-25T10:00:00+08:00`,
			endAt: `2026-11-26T00:00:00+08:00`,
			recurrence: `Every Wednesday`,
			daysAhead: 21,
		});
		expect(occurrences.map((o) => o.startAt.slice(0, 10))).toEqual([
			`2026-11-25`,
			`2026-12-02`,
			`2026-12-09`,
			`2026-12-16`,
		]);
		expect(occurrences[0]?.endAt).toBe(`2026-11-26T00:00:00+08:00`);
	});
});

describe(`parseListing`, () => {
	it(`maps wob REST payload fields`, () => {
		const listing = parseListing({
			id: 497,
			link: `https://whatsonbali.com/events/acoustic-wednesdays-at-single-fin/`,
			wob: {
				start: `2026-11-25T10:00:00+08:00`,
				end: `2026-11-26T00:00:00+08:00`,
				next_start: `2026-11-25T10:00:00+08:00`,
				next_end: `2026-11-26T00:00:00+08:00`,
				recurring: `Every Wednesday`,
				venue: `Single Fin`,
				area: { name: `Uluwatu` },
				category: { name: `Music & Nightlife` },
				price_label: null,
				ticket_url: `https://example.com/tickets`,
				image: { large: { url: `https://whatsonbali.com/img.jpg` } },
			},
		});
		expect(listing).toMatchObject({
			link: `https://whatsonbali.com/events/acoustic-wednesdays-at-single-fin/`,
			recurring: `Every Wednesday`,
			venue: `Single Fin`,
			areaName: `Uluwatu`,
			categoryName: `Music & Nightlife`,
			ticketUrl: `https://example.com/tickets`,
			imageUrl: `https://whatsonbali.com/img.jpg`,
		});
	});
});
