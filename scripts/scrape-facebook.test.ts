import { describe, expect, it, vi } from "vitest";
import { getTimezoneForCoordinatesCached } from "../src/lib/server/google.script.ts";
import {
	canonicalizeEventUrl,
	extractEventUrls,
	getAddress,
	getDescription,
	getEndAt,
	getHost,
	getHostLink,
	getImageUrls,
	getName,
	getStartAt,
	getTags,
	isBlockedHtml,
	mapFacebookHtmlEvent,
	mapGraphEvent,
	parseCliArgs,
	parseGraphPayload,
	stripAccessToken,
} from "./scrape-facebook.ts";

vi.mock(`../src/lib/server/google.script.ts`, () => ({
	geocodeAddressCached: vi.fn(async () => null),
	getTimezoneForCoordinatesCached: vi.fn(async () => null),
}));

const START_TS = Date.parse(`2027-06-01T07:00:00.000Z`) / 1000;
const END_TS = Date.parse(`2027-06-01T09:00:00.000Z`) / 1000;

const fixtureHtml = `<!DOCTYPE html>
<html>
<head>
  <meta property="og:title" content="Bali Yoga Sunrise | Facebook" />
  <meta property="og:description" content="Morning practice at the barn." />
  <meta property="og:image" content="https://scontent.xx.fbcdn.net/v/cover.jpg" />
  <meta property="og:url" content="https://www.facebook.com/events/123456789012345/" />
  <script type="application/ld+json">
  {"@type":"Event","name":"Bali Yoga Sunrise","startDate":"2027-06-01T07:00:00+08:00","endDate":"2027-06-01T09:00:00+08:00","description":"Morning practice at the barn.","image":"https://scontent.xx.fbcdn.net/v/cover.jpg","url":"https://www.facebook.com/events/123456789012345/","organizer":{"@type":"Organization","name":"Yoga Barn","url":"https://www.facebook.com/theyogabarn"},"location":{"@type":"Place","name":"The Yoga Barn","address":{"@type":"PostalAddress","streetAddress":"Jalan Raya","addressLocality":"Ubud","addressCountry":"Indonesia"},"geo":{"@type":"GeoCoordinates","latitude":-8.519,"longitude":115.265}}}
  </script>
  <script>
  window.__fb = {"__typename":"Event","id":"123456789012345","name":"Bali Yoga Sunrise","start_timestamp":${START_TS},"end_timestamp":${END_TS},"is_online":false,"event_description":{"text":"Morning practice at the barn.\\nTickets: donation"},"event_place":{"name":"The Yoga Barn","city":{"name":"Ubud"},"address":{"street":"Jalan Raya","country":"Indonesia"},"location":{"latitude":-8.519,"longitude":115.265}},"cover_photo":{"photo":{"image":{"uri":"https://scontent.xx.fbcdn.net/v/cover.jpg"}}},"event_hosts":{"nodes":[{"id":"111","name":"Yoga Barn","url":"https://www.facebook.com/theyogabarn"}]}};
  </script>
</head>
<body><h1>Bali Yoga Sunrise</h1><a href="/events/999888777666555/">other</a></body>
</html>`;

const blockedHtml = `<!DOCTYPE html><html><head><title>Error</title></head><body><h1>Sorry, something went wrong.</h1><p>We're working on getting this fixed as soon as we can.</p></body></html>`;

const graphEvent = {
	id: `987654321098765`,
	name: `Canggu Breathwork Circle`,
	description: `Group breathwork by the beach.`,
	start_time: `2027-07-10T10:00:00+0800`,
	end_time: `2027-07-10T12:00:00+0800`,
	is_online: false,
	cover: { source: `https://scontent.xx.fbcdn.net/v/graph-cover.jpg` },
	owner: { id: `222`, name: `Bali Breath` },
	ticket_uri: `https://example.com/tickets`,
	place: {
		name: `Echo Beach`,
		location: {
			city: `Canggu`,
			country: `Indonesia`,
			latitude: -8.6478,
			longitude: 115.1385,
		},
	},
};

describe(`parseCliArgs`, () => {
	it(`parses --limit, files, and event urls`, () => {
		expect(parseCliArgs([])).toEqual({ limit: undefined, files: [], urls: [] });
		expect(parseCliArgs([`--limit`, `10`, `a.html`])).toEqual({
			limit: 10,
			files: [`a.html`],
			urls: [],
		});
		expect(
			parseCliArgs([`https://www.facebook.com/events/123456789012345/`, `--limit=2`]),
		).toEqual({
			limit: 2,
			files: [],
			urls: [`https://www.facebook.com/events/123456789012345/`],
		});
	});

	it(`ignores scrape-websites runner flags`, () => {
		expect(parseCliArgs([`facebook`, `--clean`, `--dry-run`, `--log-dir`, `scrape-logs`])).toEqual({
			limit: undefined,
			files: [`facebook`],
			urls: [],
		});
	});
});

describe(`block detection and urls`, () => {
	it(`detects Facebook error/login walls`, () => {
		expect(isBlockedHtml(blockedHtml)).toBe(true);
		expect(isBlockedHtml(fixtureHtml)).toBe(false);
	});

	it(`canonicalizes and extracts event urls`, () => {
		expect(canonicalizeEventUrl(`https://m.facebook.com/events/123456789012345/?ref=share`)).toBe(
			`https://www.facebook.com/events/123456789012345/`,
		);
		expect(extractEventUrls(fixtureHtml)).toEqual([
			`https://www.facebook.com/events/999888777666555/`,
			`https://www.facebook.com/events/123456789012345/`,
		]);
	});
});

describe(`HTML field getters`, () => {
	it(`reads name, times, place, host, images from embedded/JSON-LD HTML`, () => {
		expect(getName(fixtureHtml)).toBe(`Bali Yoga Sunrise`);
		expect(getStartAt(fixtureHtml)).toBe(new Date(START_TS * 1000).toISOString());
		expect(getEndAt(fixtureHtml)).toBe(new Date(END_TS * 1000).toISOString());
		expect(getAddress(fixtureHtml)).toEqual([
			`The Yoga Barn`,
			`Ubud`,
			`Jalan Raya`,
			`Indonesia`,
		]);
		expect(getHost(fixtureHtml)).toBe(`Yoga Barn`);
		expect(getHostLink(fixtureHtml)).toBe(`https://www.facebook.com/theyogabarn`);
		expect(getImageUrls(fixtureHtml)[0]).toContain(`cover.jpg`);
		expect(getDescription(fixtureHtml)).toContain(`Morning practice`);
		expect(getTags(fixtureHtml)).toEqual([]);
	});

	it(`maps a full scraped event from HTML`, async () => {
		const event = await mapFacebookHtmlEvent({
			html: fixtureHtml,
			url: `https://www.facebook.com/events/123456789012345/`,
		});
		expect(event).toMatchObject({
			name: `Bali Yoga Sunrise`,
			source: `facebook`,
			sourceUrl: `https://www.facebook.com/events/123456789012345/`,
			host: `Yoga Barn`,
			latitude: -8.519,
			longitude: 115.265,
			timezone: null,
		});
		expect(event?.startAt).toBe(new Date(START_TS * 1000).toISOString());
	});

	it(`resolves timezone from coords when the lookup returns one`, async () => {
		const timezoneFn = getTimezoneForCoordinatesCached as unknown as ReturnType<typeof vi.fn>;
		timezoneFn.mockResolvedValueOnce(`Asia/Makassar`);
		const event = await mapFacebookHtmlEvent({
			html: fixtureHtml,
			url: `https://www.facebook.com/events/123456789012345/`,
		});
		expect(event?.timezone).toBe(`Asia/Makassar`);
		timezoneFn.mockResolvedValue(null);
	});

	it(`skips blocked HTML`, async () => {
		expect(
			await mapFacebookHtmlEvent({
				html: blockedHtml,
				url: `https://www.facebook.com/events/1/`,
			}),
		).toBeUndefined();
	});
});

describe(`Graph mapping`, () => {
	it(`parses list payloads and maps events`, () => {
		expect(parseGraphPayload(JSON.stringify({ data: [graphEvent] }))).toHaveLength(1);
		const mapped = mapGraphEvent(graphEvent);
		expect(mapped).toMatchObject({
			name: `Canggu Breathwork Circle`,
			source: `facebook`,
			sourceUrl: `https://www.facebook.com/events/987654321098765/`,
			host: `Bali Breath`,
			address: [`Echo Beach`, `Canggu`, `Indonesia`],
			latitude: -8.6478,
			longitude: 115.1385,
			contact: [`https://example.com/tickets`],
			timezone: undefined,
		});
		expect(mapped?.startAt).toContain(`2027-07-10`);
	});

	it(`strips access_token from Graph URLs before fetch/logs`, () => {
		expect(
			stripAccessToken(
				`https://graph.facebook.com/v21.0/1/events?fields=id&access_token=SECRET&limit=50`,
			),
		).toBe(`https://graph.facebook.com/v21.0/1/events?fields=id&limit=50`);
		expect(stripAccessToken(`https://graph.facebook.com/v21.0/1/events?access_token=SECRET`)).toBe(
			`https://graph.facebook.com/v21.0/1/events`,
		);
	});
});
