import { describe, expect, it } from "vitest";
import {
	collectEventCardsFromHtml,
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
	mapEventHtml,
	parseCliArgs,
} from "./scrape-balibyanilau.ts";

const listingHtml = `
<div class="offer-item bg-white">
  <h3 class="text-md">
    <a class="text-ellipsis" href="https://bali.anilau.com/en/ads/health-beauty-wellness/fitness-yoga-mental-health/the-7-gates-of-tantra-h73">
      The 7 Gates of Tantra
    </a>
  </h3>
</div>
<div class="offer-item bg-white">
  <h3 class="text-md">
    <a class="text-ellipsis" href="https://bali.anilau.com/en/ads/travel-leisure-sport/nightlife-events-tickets/ancient-soul-live-music-dragon-tea-temple-2026-12-03">
      Ancient Soul: Live Music at Dragon Tea Temple
    </a>
  </h3>
</div>
<a class="text-ellipsis" href="https://bali.anilau.com/en/ads/travel-leisure-sport/nightlife-events-tickets">Nightlife</a>
<a class="text-ellipsis" href="https://bali.anilau.com/en/ads/health-beauty-wellness/fitness-yoga-mental-health">Yoga section</a>
`;

const tantraHtml = `<!doctype html>
<html><head>
<link rel="canonical" href="https://bali.anilau.com/en/ads/health-beauty-wellness/fitness-yoga-mental-health/the-7-gates-of-tantra-h73">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Event",
  "name": "The 7 Gates of Tantra",
  "url": "https://bali.anilau.com/en/ads/health-beauty-wellness/fitness-yoga-mental-health/the-7-gates-of-tantra-h73",
  "description": "Two days of movement, breathwork and conscious connection.",
  "startDate": "2026-12-16T09:30:00+08:00",
  "endDate": "2026-12-17",
  "image": ["https://bali.anilau.com/storage/images/Service/2760/thumb_seven-gates-cover-7x5.webp"],
  "location": {
    "@type": "Place",
    "name": "Swasti Eco Cottages",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "Swasti Eco Cottages, Jl. Nyuh Bojog 3, Mas, Ubud, Bali 80571"
    }
  },
  "organizer": {
    "@type": "Organization",
    "name": "The 7 Gates of Tantra",
    "url": "https://megatix.co.id/events/seven-gates-of-tantra-bali"
  },
  "offers": {
    "@type": "Offer",
    "url": "https://megatix.co.id/events/seven-gates-of-tantra-bali",
    "price": 4500000,
    "priceCurrency": "IDR"
  }
}
</script>
</head><body>
<div class="public-photo-gallery__cover">
  <img class="public-photo-gallery__backdrop" src="https://bali.anilau.com/storage/images/Service/2760/seven-gates-cover-7x5.webp" />
</div>
<p class="service-page__teaser">Two days of movement, breathwork and conscious connection.</p>
<div class="post-text-container w-full">
  <p>The 7 Gates of Tantra is a two-day experiential retreat with Shaft Uddin.</p>
  <p>Early-bird tickets are IDR 4,500,000.</p>
</div>
<dl class="service-page__facts">
  <div><dt><span>Admission</span></dt><dd>Paid admission</dd></div>
  <div><dt><span>Organizer</span></dt>
    <dd><a href="https://megatix.co.id/events/seven-gates-of-tantra-bali">The 7 Gates of Tantra</a></dd>
  </div>
  <div><dt><span>Venue</span></dt><dd>Swasti Eco Cottages<br>Jl. Nyuh Bojog 3</dd></div>
</dl>
<a class="advertisement-badge advertisement-badge--tag" href="https://bali.anilau.com/en/tags/events">events</a>
<a class="advertisement-badge advertisement-badge--tag" href="https://bali.anilau.com/en/tags/tantra">tantra</a>
<a class="anilau-btn-primary" href="https://megatix.co.id/events/seven-gates-of-tantra-bali">Tickets</a>
</body></html>`;

const usdBodyHtml = `<!doctype html>
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Event",
  "name": "Cacao Ceremony Under the Stars",
  "url": "https://bali.anilau.com/en/ads/travel-leisure-sport/nightlife-events-tickets/cacao-ceremony-under-the-stars",
  "description": "Cacao ceremony; tuition is US$475 per week.",
  "startDate": "2027-03-08",
  "endDate": "2027-03-18",
  "location": {
    "@type": "Place",
    "name": "The Path, Pererenan",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "Jl. Munduk Tengah, Pererenan, Bali"
    }
  },
  "organizer": {
    "@type": "Organization",
    "name": "Soulwave Collective",
    "url": "https://example.com/cacao"
  }
}
</script>
</head><body>
<p class="service-page__teaser">Cacao ceremony; tuition is US$475 per week.</p>
<div class="post-text-container"><p>Join us. Tuition is US$475 per week.</p></div>
<dl class="service-page__facts">
  <div><dt><span>Admission</span></dt><dd>Paid admission</dd></div>
</dl>
</body></html>`;

const freeHtml = `<!doctype html>
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Event",
  "name": "Ecstatic Dance Community Night",
  "url": "https://bali.anilau.com/en/ads/travel-leisure-sport/nightlife-events-tickets/ecstatic-dance-community-night",
  "startDate": "2027-01-10T22:00:00+08:00",
  "endDate": "2027-01-11T04:00:00+08:00",
  "offers": { "@type": "Offer", "price": 0, "priceCurrency": "IDR", "url": "https://luma.com/example" },
  "organizer": { "@type": "Organization", "name": "Satélite Asia", "url": "https://luma.com/example" },
  "location": { "@type": "Place", "name": "Klymax", "address": "Seminyak, Bali" }
}
</script>
</head><body>
<div class="post-text-container"><p>Free entry community dance night.</p></div>
</body></html>`;

const serviceOnlyHtml = `<!doctype html>
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Service",
  "name": "Weekly Yoga Drop-in",
  "url": "https://bali.anilau.com/en/ads/health-beauty-wellness/fitness-yoga-mental-health/weekly-yoga-drop-in"
}
</script>
</head><body><h1>Weekly Yoga Drop-in</h1></body></html>`;

describe(`collectEventCardsFromHtml`, () => {
	it(`collects detail ads and skips category nav links`, () => {
		const cards = collectEventCardsFromHtml(listingHtml);
		expect(cards).toHaveLength(2);
		expect(cards[0]).toMatchObject({
			url: `https://bali.anilau.com/en/ads/health-beauty-wellness/fitness-yoga-mental-health/the-7-gates-of-tantra-h73`,
			name: `The 7 Gates of Tantra`,
		});
		expect(cards[1].name).toBe(`Ancient Soul: Live Music at Dragon Tea Temple`);
	});
});

describe(`parseCliArgs`, () => {
	it(`parses --limit forms and leftover html files`, () => {
		expect(parseCliArgs([`--limit`, `5`, `a.html`])).toEqual({ limit: 5, files: [`a.html`] });
		expect(parseCliArgs([`--limit=3`])).toEqual({ limit: 3, files: [] });
		expect(parseCliArgs([`balibyanilau`, `--clean`, `--dry-run`])).toEqual({
			limit: undefined,
			files: [`balibyanilau`],
		});
	});
});

describe(`field getters`, () => {
	it(`reads Event JSON-LD core fields`, () => {
		expect(getName(tantraHtml)).toBe(`The 7 Gates of Tantra`);
		expect(getStartAt(tantraHtml)).toBe(`2026-12-16T09:30:00+08:00`);
		expect(getEndAt(tantraHtml)).toBe(`2026-12-17T00:00:00+08:00`);
		expect(getHost(tantraHtml)).toBe(`The 7 Gates of Tantra`);
		expect(getHostLink(tantraHtml)).toBe(`https://megatix.co.id/events/seven-gates-of-tantra-bali`);
		expect(getSourceUrl(tantraHtml)).toBe(
			`https://bali.anilau.com/en/ads/health-beauty-wellness/fitness-yoga-mental-health/the-7-gates-of-tantra-h73`,
		);
		expect(getPrice(tantraHtml)).toBe(`IDR 4,500,000`);
		expect(getAddress(tantraHtml)).toEqual([
			`Swasti Eco Cottages`,
			`Swasti Eco Cottages, Jl. Nyuh Bojog 3, Mas, Ubud, Bali 80571`,
		]);
		expect(getImageUrls(tantraHtml)).toEqual([
			`https://bali.anilau.com/storage/images/Service/2760/seven-gates-cover-7x5.webp`,
		]);
		expect(getTags(tantraHtml)).toEqual([`events`, `tantra`]);
		expect(getContact(tantraHtml)).toEqual([
			`https://megatix.co.id/events/seven-gates-of-tantra-bali`,
		]);
		expect(getDescription(tantraHtml)).toContain(`Shaft Uddin`);
	});

	it(`falls back to US$ body prices before generic Paid`, () => {
		expect(getPrice(usdBodyHtml)).toBe(`$475`);
	});

	it(`maps free offer prices`, () => {
		expect(getPrice(freeHtml)).toBe(`Free`);
	});

	it(`skips Service-only ads without Event dates`, () => {
		expect(getName(serviceOnlyHtml)).toBe(`Weekly Yoga Drop-in`);
		expect(getStartAt(serviceOnlyHtml)).toBeUndefined();
	});
});

describe(`mapEventHtml`, () => {
	it(`maps a whitelist Event page`, async () => {
		const mapped = await mapEventHtml({
			html: tantraHtml,
			url: `https://bali.anilau.com/en/ads/health-beauty-wellness/fitness-yoga-mental-health/the-7-gates-of-tantra-h73`,
		});
		expect(mapped).toMatchObject({
			name: `The 7 Gates of Tantra`,
			startAt: `2026-12-16T09:30:00+08:00`,
			endAt: `2026-12-17T00:00:00+08:00`,
			price: `IDR 4,500,000`,
			source: `balibyanilau`,
			timezone: `Asia/Makassar`,
		});
		expect(mapped?.sourceUrl).toContain(`the-7-gates-of-tantra`);
	});

	it(`skips ads without Event startDate`, async () => {
		const mapped = await mapEventHtml({
			html: serviceOnlyHtml,
			url: `https://bali.anilau.com/en/ads/health-beauty-wellness/fitness-yoga-mental-health/weekly-yoga-drop-in`,
		});
		expect(mapped).toBeUndefined();
	});
});
