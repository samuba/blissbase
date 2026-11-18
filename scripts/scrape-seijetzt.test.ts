import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { dateToIsoStr } from "./common.ts";
import { WebsiteScraper } from "./scrape-seijetzt.ts";

vi.mock(`../src/lib/server/google.script.ts`, () => ({
	geocodeAddressCached: vi.fn(async () => ({ lat: 52.27, lng: 8.05, timezone: `Europe/Berlin` })),
}));

const scraper = new WebsiteScraper();
const eventHtml = readFileSync(new URL(`./fixtures/seijetzt/wohnzimmerkonzert.html`, import.meta.url), `utf8`);
const occurrenceHtml = readFileSync(new URL(`./fixtures/seijetzt/kundalini-yoga-occurrence.html`, import.meta.url), `utf8`);

describe(`saved sei.jetzt pages`, () => {
	it(`reads a normal event from JSON-LD instead of related time tags`, () => {
		expect(eventHtml).toContain(`<time datetime="2026-11-19T18:00:00+01:00">`);
		expect(scraper.extractName(eventHtml)).toBe(`Wohnzimmerkonzert mit  Johanna & Michael`);
		expect(scraper.extractStartAt(eventHtml)).toBe(dateToIsoStr(2026, 11, 19, 19, 0, `Europe/Berlin`, false));
		expect(scraper.extractStartAt(eventHtml)).toBe(`2026-11-19T19:00:00+01:00`);
		expect(scraper.extractEndAt(eventHtml)).toBe(dateToIsoStr(2026, 11, 19, 21, 0, `Europe/Berlin`, false));
		expect(scraper.extractAddress(eventHtml)).toEqual([`K27`, `Klosterstraße 27`, `49074 Osnabrück`]);
		expect(scraper.extractPrice(eventHtml)).toBe(`5,00 € - 20,00 €`);
		expect(scraper.extractDescription(eventHtml)).toContain(`Seit jeher singen Menschen`);
		expect(scraper.extractImageUrls(eventHtml)).toEqual([
			`https://sei.jetzt/storage/5393/conversions/vgn12H98PvYvMjiBT4SbxHiRzcdI7Ea1L0ulQBUr-card.webp`,
		]);
		expect(scraper.extractHost(eventHtml)).toBe(`Felix Wirsing`);
		expect(scraper.extractHostLink(eventHtml)).toBe(`https://sei.jetzt/o/felix-wirsing`);
		expect(scraper.missingEventReason(eventHtml)).toBeUndefined();
	});

	it(`reads a recurring occurrence, not the series date or a related event`, () => {
		expect(occurrenceHtml).toContain(`<time datetime="2026-11-19T18:00:00+01:00">`);
		expect(scraper.extractName(occurrenceHtml)).toBe(`Kundalini Yoga`);
		expect(scraper.extractStartAt(occurrenceHtml)).toBe(dateToIsoStr(2026, 11, 20, 18, 30, `Europe/Berlin`, false));
		expect(scraper.extractStartAt(occurrenceHtml)).toBe(`2026-11-20T18:30:00+01:00`);
		expect(scraper.extractEndAt(occurrenceHtml)).toBe(`2026-11-20T19:45:00+01:00`);
		expect(scraper.extractAddress(occurrenceHtml)).toEqual([`Haus Kroneck-Salis`, `Schloßstraße 17`, `49186 Bad Iburg`]);
		expect(scraper.extractPrice(occurrenceHtml)).toContain(`15,00 €`);
		expect(scraper.extractDescription(occurrenceHtml)).toContain(`Kundalini Yoga`);
		expect(scraper.extractImageUrls(occurrenceHtml)?.[0]).toContain(`01KSDTF54616H5VKQPBGDGFM1B`);
		expect(scraper.extractHost(occurrenceHtml)).toBe(`Eva-Maria Yoga`);
		expect(scraper.extractHostLink(occurrenceHtml)).toBe(`https://sei.jetzt/o/eva-maria-yoga`);
		expect(scraper.extractOccurrenceUrls(occurrenceHtml)).toEqual([]);
	});

	it(`maps a saved page into an event`, async () => {
		const event = await scraper.extractEventData(eventHtml, `https://sei.jetzt/event/2026-11-19-wohnzimmerkonzert-mit-johanna-michael`);
		expect(event).toMatchObject({
			name: `Wohnzimmerkonzert mit  Johanna & Michael`,
			startAt: `2026-11-19T19:00:00+01:00`,
			endAt: `2026-11-19T21:00:00+01:00`,
			source: `seijetzt`,
			latitude: 52.27,
			longitude: 8.05,
			timezone: `Europe/Berlin`,
		});
	});
});

describe(`date fallbacks`, () => {
	it(`keeps the Alpine x-data parser when JSON-LD is missing`, () => {
		const html = `<div x-data="{ start: new Date('2026-08-02T09:15:00') }"></div>
<div x-data="{ end: new Date('2026-08-02T11:00:00') }"></div>
<time datetime="2026-11-19T18:00:00+01:00">related</time>`;
		expect(scraper.extractStartAt(html)).toBe(dateToIsoStr(2026, 8, 2, 9, 15, `Europe/Berlin`, false));
		expect(scraper.extractStartAt(html)).toBe(`2026-08-02T09:15:00+02:00`);
		expect(scraper.extractEndAt(html)).toBe(`2026-08-02T11:00:00+02:00`);
	});

	it(`prefers JSON-LD over x-data and normalizes to dateToIsoStr`, () => {
		const html = `<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
  {"@type":"BreadcrumbList"},
  {"@type":"Event","startDate":"2026-07-01T18:05:30+02:00","endDate":"2026-07-02","organizer":{"name":"Ada","url":"https://sei.jetzt/o/ada"}}
]}
</script>
<div x-data="new Date('2020-01-01T01:00:00')"></div>
<div x-data="new Date('2020-01-01T02:00:00')"></div>
<time datetime="2026-11-19T18:00:00+01:00">related</time>
<a href="https://sei.jetzt/o/ada/passes">Karten ansehen</a>`;
		expect(scraper.extractStartAt(html)).toBe(dateToIsoStr(2026, 7, 1, 18, 5, `Europe/Berlin`, false));
		expect(scraper.extractStartAt(html)).toBe(`2026-07-01T18:05:00+02:00`);
		expect(scraper.extractEndAt(html)).toBe(`2026-07-02T00:00:00+02:00`);
		expect(scraper.extractHost(html)).toBe(`Ada`);
		expect(scraper.extractHostLink(html)).toBe(`https://sei.jetzt/o/ada`);
	});

	it(`does not read related time tags when the page has no JSON-LD date`, () => {
		const html = `<h1>Circle</h1><time datetime="2026-11-19T18:00:00+01:00">Do., 18:00</time>`;
		expect(scraper.extractStartAt(html)).toBeUndefined();
		expect(scraper.extractEndAt(html)).toBeUndefined();
		expect(scraper.missingEventReason(html)).toBe(`missing startAt`);
	});

	it(`names every missing required field`, () => {
		expect(scraper.missingEventReason(`<html></html>`)).toBe(`missing name, startAt`);
	});
});

describe(`rejected event logging`, () => {
	it(`logs missing startAt instead of undefined`, async () => {
		const dir = await mkdtemp(join(tmpdir(), `seijetzt-`));
		const filePath = join(dir, `event.html`);
		await writeFile(filePath, `<html><body><h1>Circle</h1><time datetime="2026-11-19T18:00:00+01:00"></time></body></html>`);
		const errorSpy = vi.spyOn(console, `error`).mockImplementation(() => {});
		const warnSpy = vi.spyOn(console, `warn`).mockImplementation(() => {});

		const events = await scraper.scrapeHtmlFiles([filePath]);

		expect(events).toEqual([]);
		expect(errorSpy).toHaveBeenCalledWith(`missing startAt: ${filePath}`);
		expect(errorSpy.mock.calls.flat()).not.toContain(undefined);
		expect(warnSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
		warnSpy.mockRestore();
	});
});
