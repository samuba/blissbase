import { describe, expect, it } from "vitest";
import {
	extractListingUrls,
	getAddress,
	getContact,
	getDescription,
	getEndAt,
	getHost,
	getHostLink,
	getImageUrls,
	getName,
	getPrice,
	getStartAt,
	getTags,
	isBaliEvent,
	looksLikeBaliEventUrl,
	mapDetailHtml,
	parseCliArgs,
} from "./scrape-everyevent.ts";

const listingHtml = `
<a class="event-card ec-tile" href="/en/events/re-birth-two-day-silent-detox-meditation-and-yoga-retreat--payangan--2026-12-04">
  <div class="tile-cap-title">Re:Birth</div>
</a>
<a class="event-card ec-tile" href="/en/events/sacred-chant-journey-with-simrit-kaur-lumina-sanctuary-3300508a">
  <div class="tile-cap-title">Sacred Chant</div>
</a>
<a class="event-card ec-tile" href="/en/events/re-birth-two-day-silent-detox-meditation-and-yoga-retreat--payangan--2026-12-04">dup</a>
`;

const detailHtml = `<!doctype html><html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"Re:Birth: Two-Day Silent Detox, Meditation and Yoga Retreat","description":"Re:Birth is a two-day silent detox, meditation and yoga retreat at Yogi's Garden in Payangan, Bali.","startDate":"2026-12-03T23:50:00.000Z","endDate":"2026-12-05T10:00:00.000Z","location":{"@type":"Place","name":"Yogi's Garden Bali","address":{"@type":"PostalAddress","addressLocality":"Payangan","addressRegion":"Bali","addressCountry":"Indonesia","streetAddress":"Jl. Ganduh No.2, Kerta, Payangan"},"geo":{"@type":"GeoCoordinates","latitude":-8.395093,"longitude":115.25029}},"image":["https://www.awaken-wellness.co/web/image/cover.webp"],"performer":[{"@type":"Person","name":"Manish Pole","url":"https://www.brightstarevents.com/en/@manish-pole","sameAs":["https://www.awaken-wellness.co/"]}],"url":"https://www.brightstarevents.com/en/events/re-birth-two-day-silent-detox-meditation-and-yoga-retreat--payangan--2026-12-04"}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How much does it cost?","acceptedAnswer":{"@type":"Answer","text":"The listed price starts from $350 and is all inclusive."}}]}</script>
</head><body>
<a class="genre-tag genre-tag--link" href="/en/discover/category/yoga">Yoga</a>
<a class="genre-tag genre-tag--link" href="/en/discover/category/meditation">Meditation</a>
<a href="https://www.awaken-wellness.co/event/re-birth/register">Get Tickets</a>
</body></html>`;

const ticketedHtml = `<!doctype html><html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"MusicEvent","name":"Yoga Sound Bath Bali","description":"A sound bath yoga evening.","startDate":"2027-03-01T12:00:00.000Z","endDate":"2027-03-01T14:00:00.000Z","location":{"@type":"Place","name":"The Yoga Barn","address":{"addressLocality":"Ubud","addressRegion":"Bali","addressCountry":"Indonesia"}},"offers":{"@type":"Offer","price":"25.00","priceCurrency":"USD","url":"https://www.brightstarevents.com/en/events/yoga-sound-bath-bali--ubud--2027-03-01"},"image":"https://example.com/cover.jpg","url":"https://www.brightstarevents.com/en/events/yoga-sound-bath-bali--ubud--2027-03-01"}</script>
</head><body></body></html>`;

describe(`parseCliArgs`, () => {
	it(`parses --limit and ignores runner flags`, () => {
		expect(parseCliArgs([`everyevent`, `--clean`, `--limit`, `4`, `a.html`])).toEqual({
			limit: 4,
			files: [`everyevent`, `a.html`],
		});
		expect(parseCliArgs([`--dry-run`, `--limit=2`, `--log-dir`, `scrape-logs`])).toEqual({
			limit: 2,
			files: [],
		});
	});
});

describe(`extractListingUrls`, () => {
	it(`dedupes event card hrefs`, () => {
		expect(extractListingUrls(listingHtml)).toEqual([
			`https://www.brightstarevents.com/en/events/re-birth-two-day-silent-detox-meditation-and-yoga-retreat--payangan--2026-12-04`,
			`https://www.brightstarevents.com/en/events/sacred-chant-journey-with-simrit-kaur-lumina-sanctuary-3300508a`,
		]);
	});
});

describe(`bali url heuristics`, () => {
	it(`detects city slug segments and bali tokens`, () => {
		expect(
			looksLikeBaliEventUrl(
				`https://www.brightstarevents.com/en/events/foo--ubud--2027-01-02`,
			),
		).toBe(true);
		expect(
			looksLikeBaliEventUrl(
				`https://www.brightstarevents.com/en/events/awakening-bali-yoga-retreat-2027--ubud--2027-01-02`,
			),
		).toBe(true);
		expect(
			looksLikeBaliEventUrl(
				`https://www.brightstarevents.com/en/events/ancient-bloom-de7cadd4`,
			),
		).toBe(false);
	});

	it(`accepts detail pages with Bali in address`, () => {
		expect(isBaliEvent(detailHtml)).toBe(true);
		expect(isBaliEvent(ticketedHtml)).toBe(true);
	});
});

describe(`field extractors`, () => {
	it(`reads Event JSON-LD, tags, FAQ price, and host links`, () => {
		expect(getName(detailHtml)).toBe(
			`Re:Birth: Two-Day Silent Detox, Meditation and Yoga Retreat`,
		);
		expect(getStartAt(detailHtml)).toBe(`2026-12-04T07:50:00+08:00`);
		expect(getEndAt(detailHtml)).toBe(`2026-12-05T18:00:00+08:00`);
		expect(getHost(detailHtml)).toBe(`Manish Pole`);
		expect(getHostLink(detailHtml)).toBe(`https://www.awaken-wellness.co/`);
		expect(getPrice(detailHtml)).toBe(`$350`);
		expect(getTags(detailHtml)).toEqual([`Yoga`, `Meditation`]);
		expect(getDescription(detailHtml)).toContain(`silent detox`);
		expect(getAddress(detailHtml)[0]).toBe(`Yogi's Garden Bali`);
		expect(getAddress(detailHtml).join(` `)).toMatch(/Payangan/);
		expect(getImageUrls(detailHtml)[0]).toBe(`https://www.awaken-wellness.co/web/image/cover.webp`);
		expect(getContact(detailHtml)).toContain(`https://www.awaken-wellness.co/`);
		expect(getContact(detailHtml)).toContain(
			`https://www.awaken-wellness.co/event/re-birth/register`,
		);
	});

	it(`formats USD offers from JSON-LD`, () => {
		expect(getPrice(ticketedHtml)).toBe(`$25`);
	});
});

describe(`mapDetailHtml`, () => {
	it(`maps a Bali wellness retreat`, () => {
		const event = mapDetailHtml({
			html: detailHtml,
			url: `https://www.brightstarevents.com/en/events/re-birth-two-day-silent-detox-meditation-and-yoga-retreat--payangan--2026-12-04`,
		});
		expect(event).toMatchObject({
			name: `Re:Birth: Two-Day Silent Detox, Meditation and Yoga Retreat`,
			startAt: `2026-12-04T07:50:00+08:00`,
			endAt: `2026-12-05T18:00:00+08:00`,
			host: `Manish Pole`,
			price: `$350`,
			source: `everyevent`,
			timezone: `Asia/Makassar`,
			latitude: -8.395093,
			longitude: 115.25029,
			sourceUrl: `https://www.brightstarevents.com/en/events/re-birth-two-day-silent-detox-meditation-and-yoga-retreat--payangan--2026-12-04`,
		});
		expect(event?.tags).toEqual([`Yoga`, `Meditation`]);
	});
});
