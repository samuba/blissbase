import { describe, expect, it } from 'vitest';
import {
	extractListingCards,
	getEndAt,
	getHost,
	getName,
	getPrice,
	getStartAt,
	mapKayanaEvent,
	parseCliArgs,
} from './scrape-kayana.ts';

const listingHtml = `
<article class="bde-loop-item ee-post">
<style>.breakdance .bde-div-89-152-908-89-1{background-image:url(https://dein-kayana.de/wp-content/uploads/2026/04/host.jpg)}</style>
<style>.breakdance .bde-div-89-151-908-89-1{background-image:url(https://dein-kayana.de/wp-content/uploads/2026/07/event.jpg)}</style>
<div class="bde-text-89-102">Kakaozeremonie</div>
<div class="bde-text-89-123">Begegne Dir selbst!</div>
<span class='bde-icon-list__text'>Klara Ströwer</span>
<span class='bde-icon-list__text'>am 23.10.2027</span>
<span class='bde-icon-list__text'>17:00 Uhr</span>
<a class="bde-container-link" href="https://dein-kayana.de/kakaozeremonie-23-10-2027/">Info</a>
</article>
<article class="bde-loop-item ee-post">
<div class="bde-text-89-102">Vollmondyoga</div>
<span class='bde-icon-list__text'>Laura</span>
<span class='bde-icon-list__text'>am 24.10.2027</span>
<span class='bde-icon-list__text'>17 - 19 Uhr</span>
<a class="bde-container-link" href="https://dein-kayana.de/vollmondyoga-24-10-2027/">Info</a>
</article>
`;

const detailHtml = `<!doctype html>
<html><body>
<div class="bde-text-70-141">Zeit mit</div>
<div class="bde-text-70-142">Mary</div>
<div class="bde-text-70-143">Am</div>
<div class="bde-text-70-144">26.10.2027</div>
<div class="bde-text-70-145">um</div>
<div class="bde-text-70-146">18:30 - 19:45</div>
<div class="bde-text-70-147">Uhr</div>
<h1 class="bde-heading-70-103">Yin Yoga</h1>
<p class="wp-block-paragraph">Auf Spendenbasis</p>
<p class="wp-block-paragraph">mary@example.org</p>
</body></html>`;

describe(`extractListingCards`, () => {
	it(`parses name, host, date, time, images, and urls`, () => {
		const cards = extractListingCards(listingHtml);
		expect(cards).toHaveLength(2);
		expect(cards[0]).toMatchObject({
			url: `https://dein-kayana.de/kakaozeremonie-23-10-2027/`,
			name: `Kakaozeremonie`,
			host: `Klara Ströwer`,
			dateText: `am 23.10.2027`,
			timeText: `17:00 Uhr`,
		});
		expect(cards[0].imageUrls).toEqual([
			`https://dein-kayana.de/wp-content/uploads/2026/04/host.jpg`,
			`https://dein-kayana.de/wp-content/uploads/2026/07/event.jpg`,
		]);
		expect(cards[1].host).toBe(`Laura`);
		expect(cards[1].timeText).toBe(`17 - 19 Uhr`);
	});
});

describe(`parseCliArgs`, () => {
	it(`parses --limit forms and leftover html files`, () => {
		expect(parseCliArgs([`--limit`, `5`, `a.html`])).toEqual({ limit: 5, files: [`a.html`] });
		expect(parseCliArgs([`--limit=3`])).toEqual({ limit: 3, files: [] });
		expect(parseCliArgs([`kayana`, `--clean`, `--dry-run`])).toEqual({
			limit: undefined,
			files: [`kayana`],
		});
	});
});

describe(`field getters`, () => {
	it(`reads listing card fields`, () => {
		const card = extractListingCards(listingHtml)[0];
		expect(getName({ url: card.url, card })).toBe(`Kakaozeremonie`);
		expect(getHost({ url: card.url, card })).toBe(`Klara Ströwer`);
		expect(getStartAt({ url: card.url, card })).toBe(`2027-10-23T17:00:00+02:00`);
		expect(getEndAt({ url: card.url, card })).toBeUndefined();
	});

	it(`parses time ranges from listing and detail`, () => {
		const card = extractListingCards(listingHtml)[1];
		expect(getStartAt({ url: card.url, card })).toBe(`2027-10-24T17:00:00+02:00`);
		expect(getEndAt({ url: card.url, card })).toBe(`2027-10-24T19:00:00+02:00`);

		expect(getName({ url: `https://dein-kayana.de/yinyoga/`, detailHtml })).toBe(`Yin Yoga`);
		expect(getHost({ url: `https://dein-kayana.de/yinyoga/`, detailHtml })).toBe(`Mary`);
		expect(getStartAt({ url: `https://dein-kayana.de/yinyoga/`, detailHtml })).toBe(
			`2027-10-26T18:30:00+02:00`,
		);
		expect(getEndAt({ url: `https://dein-kayana.de/yinyoga/`, detailHtml })).toBe(
			`2027-10-26T19:45:00+02:00`,
		);

		expect(
			getStartAt({
				url: `https://dein-kayana.de/x/`,
				card: {
					url: `https://dein-kayana.de/x/`,
					dateText: `am 31.10.2027`,
					timeText: `14.00 Uhr`,
					imageUrls: [],
					articleHtml: ``,
				},
			}),
		).toBe(`2027-10-31T14:00:00+01:00`);
		expect(
			getEndAt({
				url: `https://dein-kayana.de/x/`,
				card: {
					url: `https://dein-kayana.de/x/`,
					dateText: `am 31.10.2027`,
					timeText: `14.00 Uhr`,
					imageUrls: [],
					articleHtml: ``,
				},
			}),
		).toBeUndefined();
	});

	it(`strips trailing event dates from WP titles`, () => {
		expect(
			getName({
				url: `https://dein-kayana.de/x/`,
				post: {
					id: 1,
					link: `https://dein-kayana.de/x/`,
					title: { rendered: `Schamanischer Heilkreis zu Samhain am 30.10.2026` },
				},
			}),
		).toBe(`Schamanischer Heilkreis zu Samhain`);
		expect(
			getName({
				url: `https://dein-kayana.de/x/`,
				post: {
					id: 1,
					link: `https://dein-kayana.de/x/`,
					title: { rendered: `YinYoga 26.10.2026` },
				},
			}),
		).toBe(`YinYoga`);
	});

	it(`extracts price cues from WP content`, () => {
		expect(
			getPrice({
				url: `https://dein-kayana.de/x/`,
				post: {
					id: 1,
					link: `https://dein-kayana.de/x/`,
					content: { rendered: `<p>Spendenempfehlung: 15 – 30 €</p>` },
				},
			}),
		).toBe(`15 – 30 €`);
		expect(
			getPrice({
				url: `https://dein-kayana.de/x/`,
				post: {
					id: 1,
					link: `https://dein-kayana.de/x/`,
					content: { rendered: `<p>Meine Kakaozeremonien finden alle auf Spendenbasis statt.</p>` },
				},
			}),
		).toBe(`Spendenbasis`);
	});
});

describe(`mapKayanaEvent`, () => {
	it(`merges listing card + WP post`, async () => {
		const card = extractListingCards(listingHtml)[0];
		const event = await mapKayanaEvent({
			url: card.url,
			card,
			post: {
				id: 908,
				link: card.url,
				title: { rendered: `Kakaozeremonie 23.10.2027` },
				content: {
					rendered: `<p class="wp-block-paragraph">Vor vielen Jahren. Auf Spendenbasis.</p>`,
				},
			},
			venueCoords: { lat: 51.66, lng: 7.96, timezone: `Europe/Berlin` },
		});

		expect(event).toMatchObject({
			name: `Kakaozeremonie`,
			startAt: `2027-10-23T17:00:00+02:00`,
			host: `Klara Ströwer`,
			price: `Spendenbasis`,
			source: `kayana`,
			sourceUrl: `https://dein-kayana.de/kakaozeremonie-23-10-2027/`,
			address: [`Kayana`, `Berwicker Straße 26`, `59514 Welver`],
			latitude: 51.66,
			longitude: 7.96,
		});
		expect(event?.description).toContain(`Vor vielen Jahren`);
		expect(event?.contact).toContain(`https://t.me/deinkayana`);
		expect(event?.imageUrls?.length).toBe(2);
	});
});
