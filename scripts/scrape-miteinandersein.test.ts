import { describe, expect, it } from 'vitest';
import {
	extractEventUrls,
	getAddress,
	getDescription,
	getEndAt,
	getHost,
	getName,
	getPrice,
	getStartAt,
	getTags,
	mapMiteinanderseinEvent,
	parseCliArgs,
} from './scrape-miteinandersein.ts';

const listingHtml = `
<a href="/events/25507/">Online event</a>
<a href="/events/alena-mehner/">Host page</a>
<a href="/events/tag/fasten/">Tag</a>
<a href="https://www.miteinandersein.net/events/24994/">Offline</a>
`;

const onlineHtml = `<!doctype html>
<html><head>
<script type="application/ld+json">
{
  "@type": "Event",
  "name": "Online: Lebe deine Seelenkraft",
  "startDate": "2027-03-15T19:00:00+01:00",
  "endDate": "2027-03-15T20:00:00+01:00",
  "description": "Fernbehandlung online.",
  "url": "https://example.org/event",
  "image": "https://miteinandersein.net/uploads/veranstaltungen/2025/13644.webp",
  "location": { "@type": "VirtualLocation", "description": "online" },
  "offers": {
    "priceSpecification": { "priceCurrency": "EUR", "price": "13.00" },
    "seller": { "name": "Alena Mehner", "email": "post@example.de", "telephone": "+491778184477" }
  },
  "organizer": { "name": "Alena Mehner", "email": "post@example.de" },
  "eventAttendanceMode": "https://schema.org/OnlineEventAttendanceMode",
  "keywords": ["Heilung"]
}
</script>
</head><body>
<h1 id="main-heading"><span>Online: Lebe deine Seelenkraft</span></h1>
<span class="badge">Online</span>
<div class="col-1"><i class="bi bi-cash" aria-hidden="true"></i></div>
<div class="col-11">13,00 &euro;</div>
<a href="/events/alena-mehner/">Alena Mehner</a>
<a href="/events/tag/heilung/">Heilung</a>
<h4>Beschreibung</h4>
<p>Im Kreis arbeiten.</p>
<img class="event-img" src="/uploads/veranstaltungen/2025/13644.webp" />
</body></html>`;

const offlineHtml = `<!doctype html>
<html><head>
<script type="application/ld+json">
{
  "@type": "Event",
  "name": "Fastenwandern im Westerzgebirge",
  "startDate": "2027-03-15",
  "endDate": "2027-03-21",
  "image": "https://miteinandersein.net/uploads/veranstaltungen/2026/14140.webp",
  "location": {
    "@type": "Place",
    "name": "Haus Talblick",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "Frühbusser Str. 8 OT Weitersglashütte",
      "addressLocality": "Eibenstock",
      "postalCode": "08309",
      "addressCountry": "DE"
    }
  },
  "offers": {
    "priceSpecification": { "priceCurrency": "EUR", "minPrice": "730.00", "maxPrice": "795.00" }
  },
  "organizer": { "name": "Diana Baumgartl-Klemm" },
  "keywords": ["Fasten", "Wandern"]
}
</script>
</head><body>
<h1 id="main-heading">Fastenwandern im Westerzgebirge in Eibenstock</h1>
<address aria-label="Adresse der Veranstaltung">Haus Talblick<br>Frühbusser Str. 8<br>OT Weitersglashütte<br>08309 Eibenstock</address>
<div class="col-1"><i class="bi bi-cash" aria-hidden="true"></i></div>
<div class="col-11">730,00 – 795,00 &euro;</div>
</body></html>`;

describe(`extractEventUrls`, () => {
	it(`keeps numeric event detail URLs only`, () => {
		expect(extractEventUrls(listingHtml).sort()).toEqual([
			`https://www.miteinandersein.net/events/24994/`,
			`https://www.miteinandersein.net/events/25507/`,
		]);
	});
});

describe(`parseCliArgs`, () => {
	it(`parses --limit forms and leftover html files`, () => {
		expect(parseCliArgs([])).toEqual({ limit: undefined, files: [] });
		expect(parseCliArgs([`--limit`, `10`])).toEqual({ limit: 10, files: [] });
		expect(parseCliArgs([`-n`, `3`])).toEqual({ limit: 3, files: [] });
		expect(parseCliArgs([`--limit=5`, `a.html`])).toEqual({ limit: 5, files: [`a.html`] });
		expect(() => parseCliArgs([`--limit`, `0`])).toThrow(/Invalid --limit/);
		expect(() => parseCliArgs([`--limit=foo`])).toThrow(/Invalid --limit/);
	});
});

describe(`field getters`, () => {
	it(`reads online event fields from HTML + JSON-LD`, () => {
		expect(getName(onlineHtml)).toBe(`Online: Lebe deine Seelenkraft`);
		expect(getStartAt(onlineHtml)).toBe(`2027-03-15T19:00:00+01:00`);
		expect(getEndAt(onlineHtml)).toBe(`2027-03-15T20:00:00+01:00`);
		expect(getAddress(onlineHtml)).toEqual([`Online`]);
		expect(getPrice(onlineHtml)).toBe(`13,00€`);
		expect(getHost(onlineHtml)).toBe(`Alena Mehner`);
		expect(getTags(onlineHtml)).toEqual([`Heilung`, `Online`]);
	});

	it(`dedupes JSON-LD keywords against #hashtag links`, () => {
		const html = `<!doctype html><html><head>
<script type="application/ld+json">{"@type":"Event","keywords":["Fasten","Wandern"]}</script>
</head><body>
<a href="/events/tag/fasten/">#Fasten</a>
<a href="/events/tag/wandern/">#Wandern</a>
</body></html>`;
		expect(getTags(html)).toEqual([`Fasten`, `Wandern`]);
	});

	it(`keeps description prose without trailing tags or CTA nav`, () => {
		const html = `<!doctype html><html><body>
<h4>Beschreibung</h4>
<p>Prose about the retreat.</p>
<p><a href="/events/tag/fasten/">#Fasten</a><a href="/events/tag/wandern/">#Wandern</a></p>
<nav class="mt-4">
<a class="btn btn-primary" href="https://example.org/event" role="button">Offizielle Seite</a>
</nav>
<h4>Anbieter</h4>
</body></html>`;
		const description = getDescription(html);
		expect(description).toContain(`Prose about the retreat`);
		expect(description).not.toContain(`#Fasten`);
		expect(description).not.toContain(`/events/tag/`);
		expect(description).not.toContain(`Offizielle Seite`);
		expect(description).not.toContain(`<nav`);
	});

	it(`reads multi-day offline dates and address lines`, () => {
		expect(getStartAt(offlineHtml)).toBe(`2027-03-15T00:00:00+01:00`);
		expect(getEndAt(offlineHtml)).toBe(`2027-03-21T00:00:00+01:00`);
		expect(getAddress(offlineHtml)).toEqual([
			`Haus Talblick`,
			`Frühbusser Str. 8`,
			`OT Weitersglashütte`,
			`08309 Eibenstock`,
		]);
		expect(getPrice(offlineHtml)).toBe(`730,00 – 795,00€`);
	});
});

describe(`mapMiteinanderseinEvent`, () => {
	it(`maps a detail page into a ScrapedEvent`, async () => {
		const mapped = await mapMiteinanderseinEvent({
			html: onlineHtml,
			url: `https://www.miteinandersein.net/events/25507/`,
		});

		expect(mapped).toMatchObject({
			name: `Online: Lebe deine Seelenkraft`,
			startAt: `2027-03-15T19:00:00+01:00`,
			endAt: `2027-03-15T20:00:00+01:00`,
			address: [`Online`],
			source: `miteinandersein`,
			sourceUrl: `https://www.miteinandersein.net/events/25507/`,
			host: `Alena Mehner`,
			hostLink: `https://www.miteinandersein.net/events/alena-mehner/`,
		});
		expect(mapped?.description).toContain(`Im Kreis arbeiten`);
		expect(mapped?.imageUrls[0]).toContain(`/uploads/veranstaltungen/2025/13644.webp`);
		expect(mapped?.contact).toEqual(expect.arrayContaining([`https://example.org/event`, `post@example.de`]));
	});
});
