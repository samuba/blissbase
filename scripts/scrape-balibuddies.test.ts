import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(`../src/lib/server/google.script.ts`, () => ({
	geocodeAddressCached: vi.fn(async () => null),
}));

import { WebsiteScraper } from "./scrape-balibuddies.ts";
import { geocodeAddressCached } from "../src/lib/server/google.script.ts";

const ldDetailHtml = `<!doctype html>
<html><head>
<script type="application/ld+json">
[{
  "@context":"http://schema.org",
  "@type":"Event",
  "name":"Christmas Eve Celebration at Adriana Cocina &#038; Bar",
  "description":"&lt;p&gt;Celebrate Christmas Eve with Mexican cuisine.&lt;/p&gt;",
  "image":"https://balibuddies.com/wp-content/uploads/2026/11/adriana.png",
  "url":"https://balibuddies.com/event/christmas-eve-celebration-at-adriana-cocina/",
  "startDate":"2026-12-24T19:00:00+07:00",
  "endDate":"2026-12-24T22:30:00+07:00",
  "location":{
    "@type":"Place",
    "name":"Samasta 8th Floor Rooftop, Jl. Wanagiri No. 1, Jimbaran",
    "address":{"@type":"PostalAddress"},
    "sameAs":""
  },
  "organizer":{
    "@type":"Person",
    "name":"Adriana Cocina",
    "url":"https://example.com/adriana",
    "email":"hello@example.com"
  }
}]
</script>
</head><body>
<h1 class="tribe-events-single-event-title">Christmas Eve Celebration at Adriana Cocina &amp; Bar</h1>
<div class="tribe-events-cost">IDR 350.000</div>
<div class="tribe-events-single-event-description">
  <p>Celebrate Christmas Eve with Mexican cuisine, live music and salsa.</p>
  <img src="https://balibuddies.com/wp-content/uploads/2026/11/inline.jpg" />
</div>
<div class="tribe-events-event-image"><img class="wp-post-image" src="https://balibuddies.com/wp-content/uploads/2026/11/cover.jpg" /></div>
<div class="tribe-events-meta-group-venue"><div class="tribe-venue"><a href="/venue/samasta/">Samasta Rooftop</a></div></div>
<div class="tribe-events-meta-group-organizer"><div class="tribe-organizer"><a href="/organizer/adriana/">Adriana Cocina</a></div></div>
<div class="tribe-organizer-url"><a href="https://instagram.com/adriana">Instagram</a></div>
<div class="tribe-events-event-categories"><a href="/category/dining/">Dining</a></div>
<a rel="tag" href="/tag/bali-christmas/">Bali Christmas</a>
</body></html>`;

const domFallbackHtml = `<!doctype html>
<html><body>
<h1 class="tribe-events-single-event-title">Full Moon Cacao &amp; Sound</h1>
<span class="tribe-events-start-date" title="2027-03-15">March 15</span>
<span class="tribe-events-start-time">7:00 pm - 9:30 pm</span>
<div class="tribe-events-cost">Donation</div>
<div class="tribe-events-single-event-description"><p>Open-air cacao ceremony in Ubud.</p></div>
<div class="tribe-events-meta-group-venue"><div class="tribe-venue">Sacred Garden Ubud</div></div>
<div class="tribe-events-meta-group-organizer"><div class="tribe-organizer">Maya Healing</div></div>
<a rel="tag" href="/tag/wellness/">Wellness</a>
</body></html>`;

describe(`Bali Buddies field extractors`, () => {
	const scraper = new WebsiteScraper();

	it(`reads JSON-LD name, times, address, host, and images`, () => {
		expect(scraper.extractName(ldDetailHtml)).toBe(
			`Christmas Eve Celebration at Adriana Cocina & Bar`,
		);
		expect(scraper.extractStartAt(ldDetailHtml)).toBe(`2026-12-24T19:00:00+07:00`);
		expect(scraper.extractEndAt(ldDetailHtml)).toBe(`2026-12-24T22:30:00+07:00`);
		expect(scraper.extractAddress(ldDetailHtml)).toEqual([
			`Samasta 8th Floor Rooftop, Jl. Wanagiri No. 1, Jimbaran`,
		]);
		expect(scraper.extractHost(ldDetailHtml)).toBe(`Adriana Cocina`);
		expect(scraper.extractHostLink(ldDetailHtml)).toBe(`https://example.com/adriana`);
		expect(scraper.extractPrice(ldDetailHtml)).toBe(`IDR 350.000`);
		expect(scraper.extractTags(ldDetailHtml)).toEqual(
			expect.arrayContaining([`Dining`, `Bali Christmas`]),
		);
		expect(scraper.extractDescription(ldDetailHtml)).toContain(`Mexican cuisine`);
		expect(scraper.extractImageUrls(ldDetailHtml)).toEqual(
			expect.arrayContaining([
				`https://balibuddies.com/wp-content/uploads/2026/11/inline.jpg`,
				`https://balibuddies.com/wp-content/uploads/2026/11/cover.jpg`,
				`https://balibuddies.com/wp-content/uploads/2026/11/adriana.png`,
			]),
		);
		expect(scraper.extractContact(ldDetailHtml)).toEqual(
			expect.arrayContaining([`hello@example.com`, `https://example.com/adriana`]),
		);
	});

	it(`falls back to TEC DOM when JSON-LD is missing`, () => {
		expect(scraper.extractName(domFallbackHtml)).toBe(`Full Moon Cacao & Sound`);
		expect(scraper.extractStartAt(domFallbackHtml)).toBe(`2027-03-15T19:00:00+07:00`);
		expect(scraper.extractEndAt(domFallbackHtml)).toBe(`2027-03-15T21:30:00+07:00`);
		expect(scraper.extractAddress(domFallbackHtml)).toEqual([`Sacred Garden Ubud`]);
		expect(scraper.extractHost(domFallbackHtml)).toBe(`Maya Healing`);
		expect(scraper.extractPrice(domFallbackHtml)).toBe(`Donation`);
		expect(scraper.extractTags(domFallbackHtml)).toEqual([`Wellness`]);
		expect(scraper.extractDescription(domFallbackHtml)).toContain(`Open-air cacao`);
	});
});

describe(`extractEventData`, () => {
	beforeEach(() => {
		vi.mocked(geocodeAddressCached).mockReset();
		vi.mocked(geocodeAddressCached).mockResolvedValue(null);
	});

	it(`maps a detail page into a ScrapedEvent`, async () => {
		const scraper = new WebsiteScraper();
		const event = await scraper.extractEventData(
			ldDetailHtml,
			`https://balibuddies.com/event/christmas-eve-celebration-at-adriana-cocina/`,
		);

		expect(event).toMatchObject({
			name: `Christmas Eve Celebration at Adriana Cocina & Bar`,
			startAt: `2026-12-24T19:00:00+07:00`,
			endAt: `2026-12-24T22:30:00+07:00`,
			price: `IDR 350.000`,
			host: `Adriana Cocina`,
			hostLink: `https://example.com/adriana`,
			source: `balibuddies`,
			sourceUrl: `https://balibuddies.com/event/christmas-eve-celebration-at-adriana-cocina/`,
			timezone: `Asia/Jakarta`,
		});
		expect(event?.address[0]).toContain(`Samasta`);
		expect(event?.imageUrls?.length).toBeGreaterThan(0);
		expect(event?.description).toContain(`Mexican cuisine`);
	});

	it(`returns undefined when name or start is missing`, async () => {
		const scraper = new WebsiteScraper();
		expect(await scraper.extractEventData(`<html><body></body></html>`, `https://x`)).toBeUndefined();
		expect(
			await scraper.extractEventData(
				`<html><body><h1 class="tribe-events-single-event-title">Only name</h1></body></html>`,
				`https://x`,
			),
		).toBeUndefined();
	});
});
