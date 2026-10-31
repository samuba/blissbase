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
  <iframe src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d532487.2882341355!2d7.534732277391366!3d51.68574339702842!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x47ba5bb7e3728793%3A0x4905f2df2d5fde94!2sYogaweg%201%2C%2032805%20Horn-Bad%20Meinberg!5e0!3m2!1sde!2sde!4v1767454389983!5m2!1sde!2sde"></iframe>
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
			latitude: 51.899913,
			longitude: 8.991266,
			tags: [`Mantras und Musik`, `Bhakti Yoga`],
		});
		expect(mapped?.description).toContain(`Gemeinsames Singen`);
		expect(mapped?.description).toContain(`Dein Tag bei uns`);
		expect(mapped?.description).toContain(`Yoga für alle Levels`);
		expect(mapped?.description).toContain(`Tagesablauf`);
		expect(mapped?.description).toContain(`19:00 Uhr`);
		expect(mapped?.description).not.toContain(`Venue fluff`);
		expect(mapped?.imageUrls[0]).toContain(`nancy.jpg`);

		// South of Dortmund: the overview-map center reads as ~30km, the ashram does not.
		const dortmundSouth = { lat: 51.43, lng: 7.4 };
		const mapCenter = { lat: 51.68574339702842, lng: 7.534732277391366 };
		expect(kmBetween(dortmundSouth, mapCenter)).toBeLessThan(35);
		const latitude = mapped?.latitude;
		const longitude = mapped?.longitude;
		if (typeof latitude !== `number` || typeof longitude !== `number`) {
			throw new Error(`Bad Meinberg coordinates missing`);
		}
		expect(kmBetween(dortmundSouth, { lat: latitude, lng: longitude })).toBeGreaterThan(100);
	});

	it(`pins each house and ignores overview-map centers`, () => {
		const houses = [
			{
				ort: `Westerwald`,
				iframe: embed({
					cameraMeters: 722979.2691302692,
					lng: 7.2905133787425145,
					lat: 50.90482375627769,
					query: `Yoga%20Vidya%20Westerwald`,
				}),
				address: [`Yoga Vidya Westerwald`, `Gut Hoffnungsthal`, `57641 Oberlahr`],
				latitude: 50.613895,
				longitude: 7.54478,
			},
			{
				ort: `Nordsee`,
				iframe: embed({
					cameraMeters: 680652.6524762589,
					lng: 7.337598669210861,
					lat: 53.580587653817446,
					query: `Yoga%20Vidya%20Nordsee`,
				}),
				address: [`Yoga Vidya Nordsee`, `Wiarder Altendeich 10`, `26434 Wangerland`],
				latitude: 53.680658,
				longitude: 7.986967,
			},
			{
				ort: `Allgäu`,
				iframe: embed({
					cameraMeters: 630505.1260841949,
					lng: 10.151089719236596,
					lat: 47.687845524136165,
					query: `Yoga%20Vidya%20Allg%C3%A4u`,
				}),
				address: [`Yoga Vidya Allgäu`, `Lärchenweg 3`, `87466 Oy-Mittelberg`],
				latitude: 47.637208,
				longitude: 10.494598,
			},
		];

		for (const house of houses) {
			const mapped = mapSeminarPage({
				html: seminarHtml({ ort: house.ort, iframe: house.iframe }),
				url: `https://www.yoga-vidya.de/seminare/seminar/probe/`,
			});
			expect(mapped).toMatchObject({
				address: house.address,
				latitude: house.latitude,
				longitude: house.longitude,
			});
		}
	});

	it(`keeps a close camera for an unknown place and drops an overview camera`, () => {
		const close = mapSeminarPage({
			html: seminarHtml({
				ort: `Hamburg`,
				iframe: embed({ cameraMeters: 1200, lng: 9.9937, lat: 53.5511, query: `Hamburg` }),
			}),
			url: `https://www.yoga-vidya.de/seminare/seminar/probe/`,
		});
		expect(close).toMatchObject({ latitude: 53.5511, longitude: 9.9937 });

		const overview = mapSeminarPage({
			html: seminarHtml({
				ort: `Hamburg`,
				iframe: embed({
					cameraMeters: 532487.2882341355,
					lng: 7.534732277391366,
					lat: 51.68574339702842,
					query: `Hamburg`,
				}),
			}),
			url: `https://www.yoga-vidya.de/seminare/seminar/probe/`,
		});
		expect(overview).toMatchObject({ latitude: null, longitude: null });

		const online = mapSeminarPage({
			html: seminarHtml({
				ort: `Live Online`,
				iframe: embed({
					cameraMeters: 532487.2882341355,
					lng: 7.534732277391366,
					lat: 51.68574339702842,
					query: `Yogaweg%201%2C%2032805%20Horn-Bad%20Meinberg`,
				}),
			}),
			url: `https://www.yoga-vidya.de/seminare/seminar/probe/`,
		});
		expect(online).toMatchObject({ address: [`Online`], latitude: null, longitude: null });
	});
});

function seminarHtml(args: { ort: string; iframe: string }) {
	return `<html><body><div class="main">
    <h1 class="title">Probe</h1>
    <span class="icon-text"><span class="icon" title="Zeitraum"></span><span>10.10.26</span></span>
    <span class="icon-text"><span class="icon" title="Ort"></span><span> ${args.ort} </span></span>
    ${args.iframe}
  </div></body></html>`;
}

function embed(args: { cameraMeters: number; lng: number; lat: number; query: string }) {
	const pb = `!1m3!1d${args.cameraMeters}!2d${args.lng}!3d${args.lat}!2s${args.query}!`;
	return `<iframe src="https://www.google.com/maps/embed?pb=${pb}"></iframe>`;
}

/** Kilometers between two WGS84 points. */
function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
	const earthKm = 6371;
	const lat1 = (a.lat * Math.PI) / 180;
	const lat2 = (b.lat * Math.PI) / 180;
	const dLat = lat2 - lat1;
	const dLng = ((b.lng - a.lng) * Math.PI) / 180;
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
	return 2 * earthKm * Math.asin(Math.sqrt(h));
}
