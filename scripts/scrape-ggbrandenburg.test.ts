import { describe, expect, it, vi } from 'vitest';
import {
	extractEventUrls,
	getAddress,
	getEndAt,
	getHost,
	getImageUrls,
	getName,
	getStartAt,
	mapGgbrandenburgEvent,
	resolveEmail,
} from './scrape-ggbrandenburg.ts';

vi.mock(`../src/lib/server/google.script.ts`, () => ({
	geocodeAddressCached: vi.fn(async () => null),
}));

/** Live failure shape: `um` + zero-width spaces + h2.legacy_h5 (no end time). */
const umOnlyHtml = `<!doctype html>
<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","name":"BreadCrumb"}</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Event",
  "name": "Life-Energy Kundalini Aktivierung (Inner Dance)",
  "startDate": "2027-09-29T18:30:00+0200",
  "image": ["https://fotos.example/kundalini.webp"],
  "location": {
    "@type": "Place",
    "name": "Netzwerk Ganzheitlich Gesund",
    "address": {
      "@type": "PostalAddress",
      "postalCode": "14482",
      "addressLocality": "Potsdam",
      "addressCountry": "DE"
    }
  },
  "organizer": {
    "@type": "Organization",
    "name": "Netzwerk Ganzheitlich Gesund",
    "url": "https://www.ganzheitlich-gesund-brandenburg.de/verzeichnis/mandat.php?mandat=208607&amp;kategorie=4046"
  }
}
</script>
</head><body>
<div id="content">
  <h1>Life-Energy Kundalini Aktivierung (Inner Dance)</h1>
  <h2 class="legacy_h5">29.&#8203;09.&#8203;2027 um <time>18:30</time> Uhr</h2>
  <p class="tiny_p">Was ist Kundalini Activation?</p>
  <h3>Veranstalter / Veranstaltungsort</h3>
  <h4 class="legacy_h5"><a href="/verzeichnis/mandat.php">Netzwerk Ganzheitlich Gesund</a></h4>
</div>
</body></html>`;

/** Same-day range still uses `von` + two `<time>` nodes. */
const vonRangeHtml = `<!doctype html>
<html><head>
<script type="application/ld+json">
{
  "@type": "Event",
  "name": "Access Bars® - Gehirnreset und pure Lebensfreude!",
  "startDate": "2026-11-07T11:00:00+0100",
  "image": "https://fotos.example/access-bars.webp",
  "location": { "@type": "Place", "name": "Berlin-Charlottenburg" }
}
</script>
</head><body>
<div id="content">
  <h1>Access Bars® - Gehirnreset und pure Lebensfreude!</h1>
  <h2 class="legacy_h5">07.&#8203;11.&#8203;2026 von <time>11:00</time> – <time>19:00</time> Uhr</h2>
  <p class="tiny_p">Access Bars® ist ein revolutionärer Ansatz.</p>
  <h3>Veranstaltungsort</h3>
  <h4 class="legacy_h5">Berlin-Charlottenburg</h4>
  <h3>Veranstalter</h3>
  <h4 class="legacy_h5">Maria Waidacher, I feel so good</h4>
  <h3>Weiterführende Links</h3>
  <a href="https://i-feel-so-good.de">Website</a>
</div>
</body></html>`;

/** JSON-LD missing → HTML `um` fallback must still work. */
const htmlOnlyUm = `<!doctype html>
<html><body>
<h1>Nur HTML</h1>
<h2 class="legacy_h5">29.&#8203;09.&#8203;2027 um <time>18:30</time> Uhr</h2>
</body></html>`;

const listingHtml = `
<div class="row events-entry-3">
  <a href="/veranstaltungen/2976418/2027/09/29/life-energy-kundalini-aktivierung-inner-dance">Event</a>
  <a href="/veranstaltungen/index.php">Listing</a>
</div>
<div class="row events-entry-3">
  <a href="https://www.ganzheitlich-gesund-brandenburg.de/veranstaltungen/2858156/2026/11/07/access-bars">Access</a>
</div>
`;

describe(`extractEventUrls`, () => {
	it(`collects detail permalinks and skips the listing index`, () => {
		expect(extractEventUrls(listingHtml)).toEqual([
			`https://www.ganzheitlich-gesund-brandenburg.de/veranstaltungen/2976418/2027/09/29/life-energy-kundalini-aktivierung-inner-dance`,
			`https://www.ganzheitlich-gesund-brandenburg.de/veranstaltungen/2858156/2026/11/07/access-bars`,
		]);
	});
});

describe(`field getters`, () => {
	it(`prefers Event JSON-LD startDate for the live um-only heading`, () => {
		expect(getName(umOnlyHtml)).toBe(`Life-Energy Kundalini Aktivierung (Inner Dance)`);
		expect(getStartAt(umOnlyHtml)).toBe(`2027-09-29T18:30:00+02:00`);
		expect(getEndAt(umOnlyHtml)).toBeUndefined();
		expect(getAddress(umOnlyHtml)).toEqual([
			`Netzwerk Ganzheitlich Gesund`,
			`14482 Potsdam`,
		]);
		expect(getImageUrls(umOnlyHtml)).toEqual([`https://fotos.example/kundalini.webp`]);
		expect(getHost(umOnlyHtml)).toBe(`Netzwerk Ganzheitlich Gesund`);
	});

	it(`keeps von ranges and reads end time from the heading when JSON-LD has no endDate`, () => {
		expect(getName(vonRangeHtml)).toContain(`Access Bars`);
		expect(getStartAt(vonRangeHtml)).toBe(`2026-11-07T11:00:00+01:00`);
		expect(getEndAt(vonRangeHtml)).toBe(`2026-11-07T19:00:00+01:00`);
		expect(getHost(vonRangeHtml)).toBe(`Maria Waidacher, I feel so good`);
		expect(getAddress(vonRangeHtml)).toEqual([`Berlin-Charlottenburg`, `Potsdam`]);
	});

	it(`falls back to the um heading when JSON-LD is absent`, () => {
		expect(getStartAt(htmlOnlyUm)).toBe(`2027-09-29T18:30:00+02:00`);
		expect(getEndAt(htmlOnlyUm)).toBeUndefined();
	});
});

describe(`mapGgbrandenburgEvent`, () => {
	it(`maps the previously failing um-only page`, async () => {
		const event = await mapGgbrandenburgEvent({
			html: umOnlyHtml,
			url: `https://www.ganzheitlich-gesund-brandenburg.de/veranstaltungen/2976418/2027/09/29/life-energy-kundalini-aktivierung-inner-dance`,
		});
		expect(event?.name).toBe(`Life-Energy Kundalini Aktivierung (Inner Dance)`);
		expect(event?.startAt).toBe(`2027-09-29T18:30:00+02:00`);
		expect(event?.source).toBe(`ggbrandenburg`);
		expect(event?.timezone).toBe(`Europe/Berlin`);
	});

	it(`skips pages missing startAt`, async () => {
		const event = await mapGgbrandenburgEvent({
			html: `<h1>No date</h1>`,
			url: `https://example.test/missing`,
		});
		expect(event).toBeUndefined();
	});
});

describe(`resolveEmail`, () => {
	it(`reconstructs obfuscated mailto links`, () => {
		const raw = `<p>Mail <script>emailtext('bc.richter', 'gmx', 'de');</script><object type="multipart/example"><noscript>bc.richter(at)gmx.de</noscript></object></p>`;
		expect(resolveEmail(raw)).toContain(`mailto:bc.richter@gmx.de`);
		expect(resolveEmail(raw)).toContain(`>bc.richter@gmx.de</a>`);
	});
});
