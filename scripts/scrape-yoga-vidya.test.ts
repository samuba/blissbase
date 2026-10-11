import { describe, expect, it } from "vitest";
import {
	detectTotalPages,
	extractListingEntries,
	extractSeminarUrls,
	fetchAllSeminarUrls,
	isInScrapeWindow,
	mapSeminarPage,
	parseCliArgs,
	parseDateRange,
	scrapeWindowBounds,
} from "./scrape-yoga-vidya.ts";

const listingHtml = `
<div class="cell seminar-search-item">
  <a href=" /seminare/seminar/mantra-konzert-b261010-1/" title="Mantra-Konzert">
    <h3>Mantra-Konzert</h3>
  </a>
  Bad Meinberg 10.10.26
</div>
<a href="/seminare/suchergebnisse/?tx_solr%5Bpage%5D=2&amp;tx_solr%5Bq%5D=">2</a>
<a href="/seminare/suchergebnisse/?tx_solr%5Bpage%5D=161#top">last</a>
`;

const detailHtml = `
<html><head>
<meta property="og:url" content="https://www.yoga-vidya.de/seminare/seminar/mantra-konzert-b261010-1/"/>
<meta property="og:image" content="https://www.yoga-vidya.de/fileadmin/Seminar/Musik/nancy.jpg"/>
</head><body>
<div class="main">
  <div class="content">
    <h1 class="title is-2">Mantra-Konzert</h1>
    <div class="content">
      <span class="icon-text">
        <span class="icon" title="Zeitraum"></span><span> 10.10.26 </span>
      </span>
      <span class="icon-text">
        <span class="icon" title="Ort"></span><span> Bad Meinberg </span>
      </span>
      <span class="icon-text">
        <span class="icon" title="Preis"></span><span><span class="is-size-6"> ab </span><strong>€ 0</strong></span>
      </span>
    </div>
    <div class="category-description"><p>18:45-19:45 Uhr</p><p>Gemeinsames Singen von Mantras.</p></div>
  </div>
  <div class="content">
    <h2 class="title is-4">Dein Tag bei uns</h2>
    <p class="description-large toggle-description">Yoga für alle Levels und Mantra-Singen öffnen das Herz.</p>
  </div>
  <div class="content">
    <h3 class="title is-4">Yoga Ashram Bad Meinberg</h3>
    <div class="category-description"><p>Venue fluff that should be skipped.</p></div>
  </div>
  <h2 class="title is-4"> Lehrende </h2>
  <div class="seminar-category">
    <h3 class="title is-5">Nancy Haywood</h3>
    <a href="/seminare/leiter/nancy-haywood/">Alle Seminare</a>
  </div>
  <iframe src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d1!2d8.96!3d51.88!2m3!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2sYogaweg%201%2C%2032805%20Horn-Bad%20Meinberg!5e0"></iframe>
  <div id="seminar-submit-box">
    Interessen
    <a href="/seminare/interessengebiet/mantras-und-musik/">Mantras und Musik</a>
    <a href="/seminare/interessengebiet/bhakti-yoga/">Bhakti Yoga</a>
  </div>
</div>
<div id="daily_plan"><p>Meist Beginn um 19:00 Uhr.</p></div>
</body></html>
`;

describe(`parseDateRange`, () => {
	it(`reads single and ranged YY dates`, () => {
		expect(parseDateRange(`10.10.26`)).toEqual({
			start: { year: 2026, month: 10, day: 10 },
		});
		expect(parseDateRange(`11.10.26-16.10.26`)).toEqual({
			start: { year: 2026, month: 10, day: 11 },
			end: { year: 2026, month: 10, day: 16 },
		});
	});
});

describe(`listing helpers`, () => {
	it(`extracts seminar URLs and total pages`, () => {
		expect(extractSeminarUrls(listingHtml)).toEqual([
			`https://www.yoga-vidya.de/seminare/seminar/mantra-konzert-b261010-1/`,
		]);
		expect(detectTotalPages(listingHtml)).toBe(161);
		expect(extractListingEntries(listingHtml)).toEqual([
			{
				url: `https://www.yoga-vidya.de/seminare/seminar/mantra-konzert-b261010-1/`,
				startMs: Date.UTC(2026, 9, 10),
			},
		]);
	});

	it(`keeps paging past Solr's first-page hint and stops at the 1-year horizon`, async () => {
		const nowMs = Date.UTC(2026, 9, 11); // 2026-10-11
		const pages: Record<number, string> = {
			1: listingPageHtml({
				items: [{ slug: `soon-a`, date: `12.10.26` }],
				pageLinks: [2, 3, 4, 5, 6, 7, 8, 9, 10],
			}),
			2: listingPageHtml({
				items: [{ slug: `soon-b`, date: `01.11.26` }],
				pageLinks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
			}),
			3: listingPageHtml({
				items: [
					{ slug: `within-year`, date: `10.10.27` },
					{ slug: `beyond-year`, date: `12.10.27` },
				],
				pageLinks: [1, 2, 3, 4, 5],
			}),
			4: listingPageHtml({
				items: [{ slug: `should-not-fetch`, date: `01.11.27` }],
				pageLinks: [3, 4, 5],
			}),
		};

		const fetched: string[] = [];
		const urls = await fetchAllSeminarUrls({
			nowMs,
			loadHtml: async (url) => {
				fetched.push(url);
				const page = Number(new URL(url).searchParams.get(`tx_solr[page]`) || `1`);
				return pages[page] ?? ``;
			},
		});

		expect(fetched.length).toBe(3);
		expect(urls).toEqual([
			`https://www.yoga-vidya.de/seminare/seminar/soon-a/`,
			`https://www.yoga-vidya.de/seminare/seminar/soon-b/`,
			`https://www.yoga-vidya.de/seminare/seminar/within-year/`,
		]);
	});
});

describe(`scrape window`, () => {
	it(`keeps events from slightly past through 365 days ahead`, () => {
		const nowMs = Date.UTC(2026, 9, 11, 12);
		const { minMs, maxMs } = scrapeWindowBounds(nowMs);
		expect(isInScrapeWindow(new Date(nowMs - 60 * 60 * 1000).toISOString(), { minMs, maxMs })).toBe(
			true,
		);
		expect(isInScrapeWindow(new Date(nowMs + 364 * 24 * 60 * 60 * 1000).toISOString(), { minMs, maxMs })).toBe(
			true,
		);
		expect(isInScrapeWindow(new Date(nowMs + 366 * 24 * 60 * 60 * 1000).toISOString(), { minMs, maxMs })).toBe(
			false,
		);
		expect(isInScrapeWindow(new Date(nowMs - 24 * 60 * 60 * 1000).toISOString(), { minMs, maxMs })).toBe(
			false,
		);
	});
});

function listingPageHtml(args: {
	items: { slug: string; date: string }[];
	pageLinks: number[];
}): string {
	const cards = args.items
		.map(
			(item) => `
<div class="cell seminar-search-item">
  <a href="/seminare/seminar/${item.slug}/"><h3>${item.slug}</h3></a>
  Bad Meinberg ${item.date}
</div>`,
		)
		.join(`\n`);
	const links = args.pageLinks
		.map((page) => `<a href="/seminare/suchergebnisse/?tx_solr%5Bpage%5D=${page}">${page}</a>`)
		.join(`\n`);
	return `${cards}\n${links}`;
}

describe(`parseCliArgs`, () => {
	it(`parses --limit forms`, () => {
		expect(parseCliArgs([])).toEqual({ limit: undefined });
		expect(parseCliArgs([`--limit`, `10`])).toEqual({ limit: 10 });
		expect(parseCliArgs([`--limit=5`])).toEqual({ limit: 5 });
		expect(parseCliArgs([`-n`, `3`])).toEqual({ limit: 3 });
		expect(() => parseCliArgs([`--limit`, `0`])).toThrow(/Invalid --limit/);
		expect(() => parseCliArgs([`--limit=foo`])).toThrow(/Invalid --limit/);
	});

	it(`ignores shared runner flags and other unknowns`, () => {
		expect(parseCliArgs([`yogavidya`, `--clean`, `--dry-run`])).toEqual({ limit: undefined });
		expect(parseCliArgs([`--dry-run`, `--limit`, `7`, `--clean`, `--log-dir`, `scrape-logs`])).toEqual({
			limit: 7,
		});
		expect(parseCliArgs([`--write-baseline`, `-n`, `2`, `--exclude`, `meetup`])).toEqual({ limit: 2 });
	});
});

describe(`mapSeminarPage`, () => {
	it(`maps detail HTML fields from the seminar page`, () => {
		const mapped = mapSeminarPage({
			html: detailHtml,
			url: `https://www.yoga-vidya.de/seminare/seminar/mantra-konzert-b261010-1/`,
		});

		expect(mapped).toMatchObject({
			name: `Mantra-Konzert`,
			startAt: `2026-10-10T18:45:00+02:00`,
			endAt: `2026-10-10T19:45:00+02:00`,
			timezone: `Europe/Berlin`,
			address: [`Yogaweg 1`, `32805 Horn-Bad Meinberg`],
			price: `Kostenlos`,
			host: `Nancy Haywood`,
			hostLink: `https://www.yoga-vidya.de/seminare/leiter/nancy-haywood/`,
			sourceUrl: `https://www.yoga-vidya.de/seminare/seminar/mantra-konzert-b261010-1/`,
			source: `yogavidya`,
			latitude: 51.88,
			longitude: 8.96,
			tags: [`Mantras und Musik`, `Bhakti Yoga`],
		});
		expect(mapped?.description).toContain(`Gemeinsames Singen`);
		expect(mapped?.description).toContain(`Dein Tag bei uns`);
		expect(mapped?.description).toContain(`Yoga für alle Levels`);
		expect(mapped?.description).toContain(`Tagesablauf`);
		expect(mapped?.description).toContain(`19:00 Uhr`);
		expect(mapped?.description).not.toContain(`Venue fluff`);
		expect(mapped?.imageUrls[0]).toContain(`nancy.jpg`);
	});
});
