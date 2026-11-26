import { describe, expect, it, vi } from 'vitest';
import {
	extractEventUrlsFromSitemap,
	getAddress,
	getContact,
	getEndAt,
	getHost,
	getHostLink,
	getImageUrls,
	getName,
	getPrice,
	getSourceUrl,
	getStartAt,
	getTags,
	mapCoolEventAsiaEvent,
	parseCliArgs,
} from './scrape-cooleventasia.ts';

vi.mock(`../src/lib/server/google.script.ts`, () => ({
	geocodeAddressCached: vi.fn(async () => null),
}));

/** Timezone-less JSON-LD (10:00) vs live When label (18:00 WITA) — the #271 review case. */
const chocolateHtml = `<!doctype html><html><head>
<script type="application/ld+json">${JSON.stringify({
	[`@context`]: `https://schema.org`,
	[`@type`]: `Event`,
	name: `Chocolate Men's Cake Baking Class Bali 2026`,
	startDate: `2026-11-14T10:00`,
	endDate: `2026-11-14T13:00`,
	description: `Hands-on baking class.`,
	image: `https://cooleventasia.com/image/width=1200/media/chocolate.jpg`,
	url: `https://cooleventasia.com/event/chocolate-mens-cake-baking-class-bali-2026`,
	eventAttendanceMode: `https://schema.org/OfflineEventAttendanceMode`,
	eventStatus: `https://schema.org/EventScheduled`,
	organizer: {
		[`@type`]: `Organization`,
		name: `Cake Empire Bali`,
		url: `https://cakeempirebali.com/`,
	},
	location: {
		[`@type`]: `Place`,
		name: `Cake Empire Bali`,
		address: `Pertokoan Mahalini, Jl. Sunset Road No.18, Seminyak, Kec. Kuta, Kabupaten Badung, Bali 80361`,
	},
	offers: {
		[`@type`]: `Offer`,
		price: 1030000,
		priceCurrency: `IDR`,
		description: `IDR 1,030,000`,
		url: `https://megatix.co.id/events/open-class-baking-and-decorating-class`,
	},
})}</script>
<meta property="og:image" content="https://cooleventasia.com/image/width=1200/media/chocolate.jpg">
</head><body>
<article class="event-detail">
<h1>Chocolate Men's Cake Baking Class Bali 2026</h1>
<p class="event-lede">Hands-on baking class.</p>
<span class="event-info-label">When?</span>
<span class="event-info-value">14 Nov 2026 18:00 WITA</span>
<span class="event-info-label">Location</span>
<span class="event-info-value">Cake Empire Bali</span>
<div class="rich-text"><p>Bake and decorate a chocolate cake.</p></div>
<a class="chip chip-link" href="/event/tag/workshop">🛠️ Workshop</a>
<a class="chip chip-link" href="/event/tag/baking"> Baking</a>
<span class="ticket-price">IDR 1M</span>
<a class="ticket-row-cta" href="https://megatix.co.id/events/open-class-baking-and-decorating-class">Get tickets</a>
<a href="/organizer/cake-empire-bali">Cake Empire Bali</a>
<button data-lightbox-full="/image/width=1000/media/gallery-1.jpg"></button>
<p class="source-note">Source: <a href="https://cakeempirebali.com/about-page/">Cake Empire</a></p>
</article>
</body></html>`;

/** Offset-bearing LD that matches the When label. */
const cosmicHtml = `<!doctype html><html><head>
<script type="application/ld+json">${JSON.stringify({
	[`@context`]: `https://schema.org`,
	[`@type`]: `Event`,
	name: `Cosmic Table at Dome Bali 2026`,
	startDate: `2026-11-28T18:00:00+08:00`,
	endDate: `2026-11-28T23:00:00+08:00`,
	url: `https://cooleventasia.com/event/cosmic-table-at-dome-bali-2026`,
	eventStatus: `https://schema.org/EventScheduled`,
	organizer: {
		[`@type`]: `Organization`,
		name: `Desa Potato Head Bali`,
		url: `https://cooleventasia.com/organizer/desa-potato-head-bali`,
	},
	location: {
		[`@type`]: `Place`,
		name: `Dome, Desa Potato Head`,
		address: `OMA House Ground Level, Desa Potato Head, Jl. Petitenget No.51B, Seminyak, Badung, Bali 80361`,
	},
	offers: {
		[`@type`]: `Offer`,
		price: 0,
		priceCurrency: `IDR`,
		description: `Free entry`,
		url: `https://www.tablecheck.com/en/potato-head-bali-dome/reserve/experience/abc`,
	},
})}</script>
</head><body>
<article class="event-detail">
<h1>Cosmic Table at Dome Bali 2026</h1>
<span class="event-info-label">When?</span>
<span class="event-info-value">28 Nov 2026 18:00 WITA</span>
<span class="event-info-label">Location</span>
<span class="event-info-value">Dome, Desa Potato Head, Bali</span>
<a class="chip chip-link" href="/event/tag/meetup">🤝 Meetup</a>
<a class="chip chip-link" href="/event/tag/music">🎵 Music</a>
</article>
</body></html>`;

/** Multi-day When range with nested “Happening” badge inside the label. */
const wildSoulHtml = `<!doctype html><html><head>
<script type="application/ld+json">${JSON.stringify({
	[`@context`]: `https://schema.org`,
	[`@type`]: `Event`,
	name: `Wild Soul Breathwork & Somatics Facilitator Training Bali 2026`,
	startDate: `2026-11-26T08:00:00+08:00`,
	endDate: `2026-11-30T17:00:00+08:00`,
	url: `https://cooleventasia.com/event/wild-soul-breathwork-somatics-facilitator-training-bali-2026`,
	eventStatus: `https://schema.org/EventScheduled`,
	organizer: {
		[`@type`]: `Organization`,
		name: `Anne Marie Kramer / Wild Soul Breath`,
		url: `https://cooleventasia.com/organizer/anne-marie-kramer-wild-soul-breath`,
	},
	location: {
		[`@type`]: `Place`,
		name: `Path Wellness Center`,
		address: `Jl. Munduk Tengah No. 3, Pererenan, Mengwi, Badung, Bali 80351, Indonesia`,
	},
	offers: {
		[`@type`]: `Offer`,
		price: 2200,
		priceCurrency: `USD`,
		description: `USD 2,200`,
		url: `https://thepathyogacenter.com/training/breathwork-facilitator-training-bali`,
	},
})}</script>
</head><body>
<article class="event-detail">
<h1>Wild Soul Breathwork &amp; Somatics Facilitator Training Bali 2026</h1>
<span class="event-info-label">When? <span class="event-info-live">Happening</span></span>
<span class="event-info-value">26 - 30 Nov 2026 08:00 WITA</span>
<span class="event-info-label">Location</span>
<span class="event-info-value">Path Wellness Center, Bali</span>
<a class="chip chip-link" href="/event/tag/breathwork"> Breathwork</a>
</article>
</body></html>`;

const cancelledHtml = `<!doctype html><html><head>
<script type="application/ld+json">${JSON.stringify({
	[`@context`]: `https://schema.org`,
	[`@type`]: `Event`,
	name: `Cancelled Meetup Bali 2027`,
	startDate: `2027-06-01T18:00:00+08:00`,
	endDate: `2027-06-01T20:00:00+08:00`,
	url: `https://cooleventasia.com/event/cancelled-meetup-bali-2027`,
	eventStatus: `https://schema.org/EventCancelled`,
})}</script>
</head><body>
<article class="event-detail"><h1>Cancelled Meetup Bali 2027</h1>
<span class="event-info-label">When?</span>
<span class="event-info-value">1 Jun 2027 18:00 WITA</span>
</article></body></html>`;

const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset>
  <url><loc>https://cooleventasia.com/event/region/bali</loc></url>
  <url><loc>https://cooleventasia.com/event/tag/workshop</loc></url>
  <url><loc>https://cooleventasia.com/event/cosmic-table-at-dome-bali-2026</loc></url>
  <url><loc>https://www.cooleventasia.com/event/cosmic-table-at-dome-bali-2026/</loc></url>
  <url><loc>https://cooleventasia.com/about</loc></url>
  <url><loc>https://cooleventasia.com/event/wild-soul-breathwork-somatics-facilitator-training-bali-2026</loc></url>
</urlset>`;

describe(`extractEventUrlsFromSitemap`, () => {
	it(`keeps /event/{slug} and drops region/tag/duplicates`, () => {
		expect(extractEventUrlsFromSitemap(sitemapXml)).toEqual([
			`https://cooleventasia.com/event/cosmic-table-at-dome-bali-2026`,
			`https://cooleventasia.com/event/wild-soul-breathwork-somatics-facilitator-training-bali-2026`,
		]);
	});
});

describe(`parseCliArgs`, () => {
	it(`parses --limit forms and leftover html files`, () => {
		expect(parseCliArgs([`--limit`, `5`, `a.html`])).toEqual({ limit: 5, files: [`a.html`] });
		expect(parseCliArgs([`--limit=3`])).toEqual({ limit: 3, files: undefined });
		expect(parseCliArgs([`cea`, `--clean`, `--dry-run`])).toEqual({
			limit: undefined,
			files: [`cea`],
		});
	});
});

describe(`When label vs timezone-less JSON-LD`, () => {
	it(`prefers WITA When over LD wall-clock for start and duration-derived end`, () => {
		// LD says 10:00–13:00; live When is 18:00 WITA → end 21:00 via LD duration.
		expect(getStartAt(chocolateHtml)).toBe(`2026-11-14T18:00:00+08:00`);
		expect(getEndAt(chocolateHtml)).toBe(`2026-11-14T21:00:00+08:00`);
	});

	it(`keeps offset-bearing LD that already matches When`, () => {
		expect(getStartAt(cosmicHtml)).toBe(`2026-11-28T18:00:00+08:00`);
		expect(getEndAt(cosmicHtml)).toBe(`2026-11-28T23:00:00+08:00`);
	});

	it(`parses multi-day When ranges even with a Happening badge`, () => {
		expect(getStartAt(wildSoulHtml)).toBe(`2026-11-26T08:00:00+08:00`);
		expect(getEndAt(wildSoulHtml)).toBe(`2026-11-30T23:59:00+08:00`);
	});
});

describe(`field getters`, () => {
	it(`reads name, host, price, tags, address, images, contact`, () => {
		expect(getName(chocolateHtml)).toBe(`Chocolate Men's Cake Baking Class Bali 2026`);
		expect(getHost(chocolateHtml)).toBe(`Cake Empire Bali`);
		expect(getHostLink(chocolateHtml)).toBe(`https://cakeempirebali.com/`);
		expect(getPrice(chocolateHtml)).toBe(`IDR 1,030,000`);
		expect(getPrice(cosmicHtml)).toBe(`Free`);
		expect(getTags(chocolateHtml)).toEqual([`Workshop`, `Baking`]);
		expect(getAddress(chocolateHtml)[0]).toBe(`Cake Empire Bali`);
		expect(getAddress(chocolateHtml)).toContain(`Seminyak`);
		expect(getImageUrls(chocolateHtml)?.length).toBeGreaterThan(0);
		expect(getContact(chocolateHtml)).toEqual(
			expect.arrayContaining([
				`https://megatix.co.id/events/open-class-baking-and-decorating-class`,
				`https://cakeempirebali.com/about-page/`,
			]),
		);
		expect(
			getSourceUrl({
				html: chocolateHtml,
				url: `https://cooleventasia.com/event/chocolate-mens-cake-baking-class-bali-2026?x=1`,
			}),
		).toBe(`https://cooleventasia.com/event/chocolate-mens-cake-baking-class-bali-2026`);
	});
});

describe(`mapCoolEventAsiaEvent`, () => {
	it(`maps a full upcoming event`, async () => {
		const event = await mapCoolEventAsiaEvent({
			html: cosmicHtml,
			url: `https://cooleventasia.com/event/cosmic-table-at-dome-bali-2026`,
		});
		expect(event).toMatchObject({
			name: `Cosmic Table at Dome Bali 2026`,
			startAt: `2026-11-28T18:00:00+08:00`,
			endAt: `2026-11-28T23:00:00+08:00`,
			timezone: `Asia/Makassar`,
			price: `Free`,
			host: `Desa Potato Head Bali`,
			source: `cooleventasia`,
			sourceUrl: `https://cooleventasia.com/event/cosmic-table-at-dome-bali-2026`,
		});
		expect(event?.tags).toEqual([`Meetup`, `Music`]);
	});

	it(`skips cancelled events`, async () => {
		const event = await mapCoolEventAsiaEvent({
			html: cancelledHtml,
			url: `https://cooleventasia.com/event/cancelled-meetup-bali-2027`,
		});
		expect(event).toBeUndefined();
	});
});
