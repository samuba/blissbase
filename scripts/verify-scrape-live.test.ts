import { describe, expect, it, vi } from "vitest";
import { NotFoundError } from "./common.ts";
import { getStartAt, liveProbe, readGgbrandenburgLive } from "./scrape-ggbrandenburg.ts";
import {
	compareReading,
	formatLiveReport,
	parseSampleLimit,
	parseVerifyArgs,
	runLiveCheck,
	verifySource,
	type LiveProbe,
} from "./verify-scrape-live.ts";

const geocode = vi.hoisted(() => ({ loaded: false }));

vi.mock(`../src/lib/server/google.script.ts`, () => {
	geocode.loaded = true;
	return { geocodeAddressCached: vi.fn(async () => null) };
});

vi.mock(`./scrape-heilnetz.ts`, () => ({
	WebsiteScraper: class WebsiteScraper {},
	liveProbe: undefined,
}));

const kundaliniUrl = `https://www.ganzheitlich-gesund-brandenburg.de/veranstaltungen/2976418/2027/09/29/life-energy-kundalini-aktivierung-inner-dance`;
const accessUrl = `https://www.ganzheitlich-gesund-brandenburg.de/veranstaltungen/2858156/2026/11/07/access-bars`;

describe(`readGgbrandenburgLive`, () => {
	it(`matches JSON-LD to the URL day and the um heading`, () => {
		expect(geocode.loaded).toBe(false);
		expect(compareReading(readGgbrandenburgLive({ url: kundaliniUrl, html: umOnlyHtml }))).toEqual({
			kind: `match`,
			url: kundaliniUrl,
		});
		expect(geocode.loaded).toBe(false);
	});

	it(`matches a von heading to the URL day`, () => {
		expect(compareReading(readGgbrandenburgLive({ url: accessUrl, html: vonRangeHtml }))).toEqual({
			kind: `match`,
			url: accessUrl,
		});
	});

	it(`mismatches when the URL day disagrees with JSON-LD startAt`, () => {
		const shifted = kundaliniUrl.replace(`/2027/09/29/`, `/2027/09/30/`);
		expect(getStartAt(umOnlyHtml)).toBe(`2027-09-29T18:30:00+02:00`);
		const verdict = compareReading(readGgbrandenburgLive({ url: shifted, html: umOnlyHtml }));
		expect(verdict).toEqual({
			kind: `mismatch`,
			url: shifted,
			fields: [
				{
					field: `startAt`,
					scraper: `2027-09-29T18:30:00+02:00`,
					witness: `day 2027-09-30, instant 2027-09-29T18:30:00+02:00`,
				},
			],
		});
	});

	it(`treats a missing h1 as a name gap and a missing clock as a start gap`, () => {
		const noHeading = compareReading(
			readGgbrandenburgLive({
				url: kundaliniUrl,
				html: umOnlyHtml.replace(/<h1>[\s\S]*?<\/h1>/, ``),
			}),
		);
		expect(noHeading.kind).toBe(`gap`);
		if (noHeading.kind === `gap`) expect(noHeading.fields).toContain(`name`);

		const noClock = compareReading(
			readGgbrandenburgLive({
				url: `https://example.test/no-date`,
				html: `<h1>Nur HTML</h1>`,
			}),
		);
		expect(noClock).toEqual({
			kind: `gap`,
			url: `https://example.test/no-date`,
			fields: [`startAt`],
		});
	});
});

describe(`compareReading`, () => {
	it(`uses the Berlin calendar day instead of the UTC date`, () => {
		const utcEvening = `2027-09-29T23:30:00Z`;
		const berlinMorning = `2027-09-30T01:30:00+02:00`;
		expect(
			compareReading({
				url: `https://example.test/night`,
				scraper: { name: `Night`, startAt: utcEvening },
				witness: { name: `Night`, startDay: `2027-09-30`, startAt: berlinMorning },
			}).kind,
		).toBe(`match`);
		expect(
			compareReading({
				url: `https://example.test/night`,
				scraper: { name: `Night`, startAt: utcEvening },
				witness: { name: `Night`, startDay: `2027-09-29`, startAt: berlinMorning },
			}).kind,
		).toBe(`mismatch`);
	});

	it(`treats an unreadable witness instant as a gap when the day agrees`, () => {
		expect(
			compareReading({
				url: `https://example.test/night`,
				scraper: { name: `Night`, startAt: `2027-09-30T01:30:00+02:00` },
				witness: { name: `Night`, startDay: `2027-09-30`, startAt: `not-a-date` },
			}).kind,
		).toBe(`gap`);
	});

	it(`compares names with collapsed whitespace`, () => {
		expect(
			compareReading({
				url: kundaliniUrl,
				scraper: { name: `  Life-Energy   Kundalini Aktivierung (Inner Dance) `, startAt: `2027-09-29T18:30:00+02:00` },
				witness: {
					name: `Life-Energy Kundalini Aktivierung (Inner Dance)`,
					startDay: `2027-09-29`,
					startAt: `2027-09-29T18:30:00+02:00`,
				},
			}).kind,
		).toBe(`match`);
	});
});

describe(`runLiveCheck`, () => {
	it(`fails when a detail page is gone and still records an unreachable page`, async () => {
		const gone = await runLiveCheck({
			probe: liveProbe,
			limit: parseSampleLimit(`10`),
			fetchText: async (url) => {
				if (url.endsWith(`/veranstaltungen/index.php`)) return listingHtml;
				if (url === kundaliniUrl) return umOnlyHtml;
				throw new NotFoundError(`Error fetching ${url}: 404 Not Found`);
			},
		});
		expect(gone.exitCode).toBe(1);
		expect(gone.kind).toBe(`checked`);
		if (gone.kind !== `checked`) return;
		expect(gone.pages.map((page) => page.kind)).toEqual([`match`, `gone`]);
		expect(formatLiveReport(gone)).toContain(`GONE ${accessUrl} Error fetching ${accessUrl}: 404 Not Found`);
		expect(formatLiveReport(gone)).toContain(`1 matched, 0 mismatched, 0 gaps, 1 gone, 0 unreachable`);

		const skipped = await runLiveCheck({
			probe: liveProbe,
			limit: parseSampleLimit(`10`),
			fetchText: async (url) => {
				if (url.endsWith(`/veranstaltungen/index.php`)) return listingHtml;
				if (url === kundaliniUrl) return umOnlyHtml;
				throw new Error(`Error fetching ${url}: 503 Service Unavailable`);
			},
		});
		expect(skipped.exitCode).toBe(0);
		expect(formatLiveReport(skipped)).toContain(`SKIP ${accessUrl} Error fetching ${accessUrl}: 503 Service Unavailable`);
		expect(formatLiveReport(skipped)).toContain(`1 matched, 0 mismatched, 0 gaps, 0 gone, 1 unreachable`);
	});

	it(`exits 2 when every detail fetch is unreachable`, async () => {
		const report = await runLiveCheck({
			probe: liveProbe,
			limit: parseSampleLimit(`2`),
			fetchText: async (url) => {
				if (url.endsWith(`/veranstaltungen/index.php`)) return listingHtml;
				throw new Error(`timeout ${url}`);
			},
		});
		expect(report.exitCode).toBe(2);
		expect(formatLiveReport(report)).toContain(`0 matched, 0 mismatched, 0 gaps, 0 gone, 2 unreachable`);
	});

	it(`reports a listing failure without checking detail pages`, async () => {
		const report = await runLiveCheck({
			probe: liveProbe,
			limit: parseSampleLimit(`2`),
			fetchText: async () => {
				throw new Error(`listing down`);
			},
		});
		expect(report).toMatchObject({
			kind: `listing-failed`,
			exitCode: 2,
			reason: `listing down`,
			summary: `listing failed: listing down`,
		});
	});

	it(`keeps a read error in the report as unreachable`, async () => {
		const report = await runLiveCheck({
			probe: probeFor([`https://example.test/bad`]),
			limit: parseSampleLimit(`1`),
			fetchText: async () => `<html></html>`,
		});
		expect(report.exitCode).toBe(2);
		expect(formatLiveReport(report)).toContain(`SKIP https://example.test/bad bad html`);
	});

	it(`samples at most 10 distinct urls evenly across the listing`, async () => {
		const urls = Array.from({ length: 25 }, (_item, index) => `https://example.test/e/${index}`);
		const fetched: string[] = [];
		const report = await runLiveCheck({
			probe: {
				source: `ggbrandenburg`,
				async listTargets() {
					return urls.map((url) => ({ url }));
				},
				read({ url }) {
					return {
						url,
						scraper: { name: `Event`, startAt: `2026-06-15T12:00:00+02:00` },
						witness: { name: `Event`, startDay: `2026-06-15`, startAt: `2026-06-15T12:00:00+02:00` },
					};
				},
			},
			limit: parseSampleLimit(undefined),
			fetchText: async (url) => {
				fetched.push(url);
				return `body`;
			},
		});
		expect(report.exitCode).toBe(0);
		expect(fetched).toHaveLength(10);
		expect(new Set(fetched).size).toBe(10);
		const indexes = fetched.map((url) => urls.indexOf(url));
		expect(indexes[0]).toBe(0);
		expect(indexes.at(-1)).toBe(urls.length - 1);
		for (let index = 1; index < indexes.length; index++) {
			const gap = indexes[index] - indexes[index - 1];
			expect(gap).toBeGreaterThanOrEqual(2);
			expect(gap).toBeLessThanOrEqual(3);
		}

		const ends: string[] = [];
		await runLiveCheck({
			probe: {
				source: `ggbrandenburg`,
				async listTargets() {
					return urls.map((url) => ({ url }));
				},
				read({ url }) {
					return {
						url,
						scraper: { name: `Event`, startAt: `2026-06-15T12:00:00+02:00` },
						witness: { name: `Event`, startDay: `2026-06-15`, startAt: `2026-06-15T12:00:00+02:00` },
					};
				},
			},
			limit: parseSampleLimit(`2`),
			fetchText: async (url) => {
				ends.push(url);
				return `body`;
			},
		});
		expect(ends).toEqual([urls[0], urls[urls.length - 1]]);

		const repeated = [0, 1, 2, 3].flatMap((index) => Array.from({ length: 8 }, () => `https://example.test/dup/${index}`));
		const unique: string[] = [];
		await runLiveCheck({
			probe: probeFor(repeated),
			limit: parseSampleLimit(`10`),
			fetchText: async (url) => {
				unique.push(url);
				return `body`;
			},
		});
		expect(unique).toEqual([
			`https://example.test/dup/0`,
			`https://example.test/dup/1`,
			`https://example.test/dup/2`,
			`https://example.test/dup/3`,
		]);
	});

	it(`asks the ggbrandenburg probe for the whole listing and then caps the sample`, async () => {
		const fetched: string[] = [];
		const report = await runLiveCheck({
			probe: liveProbe,
			limit: parseSampleLimit(`1`),
			fetchText: async (url) => {
				fetched.push(url);
				if (url.endsWith(`/veranstaltungen/index.php`)) return listingHtml;
				return umOnlyHtml;
			},
		});
		const listingUrl = `https://www.ganzheitlich-gesund-brandenburg.de/veranstaltungen/index.php`;
		expect(fetched.filter((url) => url !== listingUrl)).toEqual([kundaliniUrl]);
		expect(report.exitCode).toBe(0);
	});
});

describe(`parseVerifyArgs`, () => {
	it(`requires one known source and a limit from 1 to 10`, () => {
		expect(() => parseVerifyArgs([])).toThrow(`Usage: bun run scripts/verify-scrape-live.ts <source> [--limit n]`);
		expect(parseVerifyArgs([`ggbrandenburg`])).toEqual({ source: `ggbrandenburg`, limit: 10 });
		expect(parseVerifyArgs([`--limit=3`, `GGBrandenburg`])).toEqual({ source: `ggbrandenburg`, limit: 3 });
		expect(() => parseVerifyArgs([`ggbrandenburg`, `heilnetz`])).toThrow(/Expected one source/);
		expect(() => parseVerifyArgs([`nope`])).toThrow(/Unknown source "nope"\. Known sources: .*ggbrandenburg/);
		expect(() => parseVerifyArgs([`ggbrandenburg`, `--limit`, `11`])).toThrow(`--limit must be an integer from 1 to 10`);
		expect(() => parseVerifyArgs([`ggbrandenburg`, `--limit`, `0`])).toThrow(`--limit must be an integer from 1 to 10`);
		expect(() => parseVerifyArgs([`ggbrandenburg`, `--all`])).toThrow(/Usage: bun run scripts\/verify-scrape-live\.ts <source>/);
	});
});

describe(`verifySource`, () => {
	it(`exits 2 when the scraper module has no liveProbe`, async () => {
		const report = await verifySource({ source: `heilnetz`, limit: parseSampleLimit(`1`) });
		expect(report).toEqual({
			kind: `unwitnessed`,
			source: `heilnetz`,
			exitCode: 2,
			summary: `unwitnessed: no liveProbe`,
		});
		expect(formatLiveReport(report)).toBe(`heilnetz\nunwitnessed: no liveProbe\n`);
		expect(geocode.loaded).toBe(false);
	});
});

function probeFor(urls: string[]): LiveProbe {
	return {
		source: `ggbrandenburg`,
		async listTargets() {
			return urls.map((url) => ({ url }));
		},
		read() {
			throw new Error(`bad html`);
		},
	};
}

const umOnlyHtml = `<!doctype html>
<html><head>
<script type="application/ld+json">
{
  "@type": "Event",
  "name": "Life-Energy Kundalini Aktivierung (Inner Dance)",
  "startDate": "2027-09-29T18:30:00+0200"
}
</script>
</head><body>
<h1>Life-Energy Kundalini Aktivierung (Inner Dance)</h1>
<h2 class="legacy_h5">29.&#8203;09.&#8203;2027 um <time>18:30</time> Uhr</h2>
</body></html>`;

const vonRangeHtml = `<!doctype html>
<html><head>
<script type="application/ld+json">
{
  "@type": "Event",
  "name": "Access Bars® - Gehirnreset und pure Lebensfreude!",
  "startDate": "2026-11-07T11:00:00+0100"
}
</script>
</head><body>
<h1>Access Bars® - Gehirnreset und pure Lebensfreude!</h1>
<h2 class="legacy_h5">07.&#8203;11.&#8203;2026 von <time>11:00</time> – <time>19:00</time> Uhr</h2>
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
