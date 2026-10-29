import { describe, expect, it } from "vitest";
import {
	isTrustedVenue,
	isUpcomingStart,
	mapMegatixEvent,
	megatixLocations,
	nearestLocation,
	parseEventDetail,
	passesNameLists,
	uniqueHits,
} from "./scrape-megatix_indonesia.ts";

const baliPlaces = [`Amed`, `Bali`, `Canggu`, `Gili Islands`, `Kuta Lombok`, `Lembongan`, `Lombok`, `The Nusas`, `Ubud`, `Uluwatu`];

describe(`megatixLocations`, () => {
	it(`uses every Indonesia place and no other country`, () => {
		expect(
			megatixLocations()
				.map((location) => location.name)
				.sort(),
		).toEqual([...baliPlaces].sort());
		expect(
			megatixLocations(`Indonesia`)
				.map((location) => location.name)
				.sort(),
		).toEqual([...baliPlaces].sort());
	});

	it(`narrows to one place, including the Amed alias`, () => {
		expect(megatixLocations(`Bali`).map((location) => location.name)).toEqual([`Bali`]);
		expect(megatixLocations(`Ubud`).map((location) => location.name)).toEqual([`Ubud`]);
		expect(megatixLocations(`Amet`).map((location) => location.name)).toEqual([`Amed`]);
	});

	it(`rejects a country this source does not scrape`, () => {
		expect(() => megatixLocations(`Germany`)).toThrow(/No location/);
	});
});

describe(`passesNameLists`, () => {
	it(`keeps a whitelist title and drops a blacklist title`, () => {
		expect(passesNameLists(`FRIDAY Ecstatic Dance`)).toBe(true);
		expect(passesNameLists(`Bali Pub Crawl - Seminyak`)).toBe(false);
		expect(passesNameLists(`DISSOLVE :: PLAY`)).toBe(false);
		expect(passesNameLists(``)).toBe(false);
		expect(passesNameLists(undefined)).toBe(false);
	});

	it(`keeps metal bowl and biodynamic titles`, () => {
		expect(passesNameLists(`Crystal & Metal Bowl Fusion`)).toBe(true);
		expect(passesNameLists(`Biodynamic Osteopathy`)).toBe(true);
	});
});

describe(`isTrustedVenue`, () => {
	it(`trusts Yoga Barn and Paradiso by promoter or venue`, () => {
		expect(isTrustedVenue({ promoterName: `The Yoga Barn`, venueName: undefined })).toBe(true);
		expect(isTrustedVenue({ promoterName: `DJ Someone`, venueName: `Paradiso Ubud` })).toBe(true);
		expect(isTrustedVenue({ promoterName: `Bali Bar Crawl`, venueName: `Cést La Vie` })).toBe(false);
	});
});

describe(`nearestLocation`, () => {
	it(`keeps Uluwatu on its own place and not on the Bali center alone`, () => {
		const uluwatu = megatixLocations(`Uluwatu`)[0];
		const point = { lat: uluwatu.lat, lng: uluwatu.lon };

		expect(nearestLocation({ point, locations: megatixLocations(`Bali`) })).toBeUndefined();
		expect(nearestLocation({ point, locations: megatixLocations() })?.name).toBe(`Uluwatu`);
	});

	it(`keeps Nusa Penida, the Gilis, and south Lombok`, () => {
		const locations = megatixLocations();
		expect(nearestLocation({ point: { lat: -8.7275, lng: 115.5444 }, locations })?.name).toBe(`The Nusas`);
		expect(nearestLocation({ point: { lat: -8.3505, lng: 116.0384 }, locations })?.name).toBe(`Gili Islands`);
		expect(nearestLocation({ point: { lat: -8.9126, lng: 116.2339 }, locations })?.name).toBe(`Kuta Lombok`);
	});

	it(`drops a Jakarta point`, () => {
		expect(
			nearestLocation({
				point: { lat: -6.2088, lng: 106.8456 },
				locations: megatixLocations(),
			}),
		).toBeUndefined();
	});

	it(`picks the closer of two places inside the radius`, () => {
		const ubud = megatixLocations(`Ubud`)[0];
		expect(
			nearestLocation({
				point: { lat: ubud.lat, lng: ubud.lon },
				locations: megatixLocations(),
			})?.name,
		).toBe(`Ubud`);
	});
});

describe(`isUpcomingStart`, () => {
	it(`drops a start more than a day before now`, () => {
		const now = Date.parse(`2026-10-20T12:00:00+08:00`);
		expect(isUpcomingStart({ startAt: `2026-10-20T09:00:00+08:00`, now })).toBe(true);
		expect(isUpcomingStart({ startAt: `2026-10-18T09:00:00+08:00`, now })).toBe(false);
		expect(isUpcomingStart({ startAt: `not-a-date`, now })).toBe(false);
	});
});

describe(`uniqueHits`, () => {
	it(`drops a hit repeated when the catalog shifts between pages`, () => {
		expect(uniqueHits([hit({ id: 1 }), hit({ id: 2 }), hit({ id: 2 }), hit({ id: 3 })]).map((row) => row.id)).toEqual([1, 2, 3]);
	});
});

describe(`parseEventDetail`, () => {
	it(`keeps the venue address as written when coordinates are missing`, () => {
		const detail = parseEventDetail({
			data: {
				description: `<p>Weekly dance.</p>`,
				venue: {
					name: `The Yoga Barn`,
					full_address: `The Yoga Barn Ubud 80571 Indonesia`,
					latitude: null,
					longitude: null,
				},
			},
		});

		expect(detail).toEqual({
			descriptionHtml: `<p>Weekly dance.</p>`,
			addressLines: [`The Yoga Barn`, `The Yoga Barn Ubud 80571 Indonesia`],
			venuePoint: undefined,
		});
	});

	it(`uses numeric venue coordinates when the API sends them`, () => {
		const detail = parseEventDetail({
			data: {
				venue: { latitude: `-8.51`, longitude: `115.26` },
			},
		});
		expect(detail?.venuePoint).toEqual({ lat: -8.51, lng: 115.26 });
	});
});

describe(`mapMegatixEvent`, () => {
	it(`maps a Yoga Barn listing from the venue text and the resolved point`, () => {
		const mapped = mapMegatixEvent({
			hit: hit({
				id: 20551,
				name: `FRIDAY Ecstatic Dance`,
				slug: `yoga-barn-friday-ecstatic-dance`,
				promoterName: `The Yoga Barn`,
				startDatetime: `2026-10-23 19:15:00`,
				endDatetime: `2026-10-23 21:00:00`,
				displayPrice: `Rp 120,000`,
				coverUrl: `https://media.megatix.com.au/e/20551/cover.jpg`,
			}),
			detail: {
				descriptionHtml: `<p>Weekly dance.</p>`,
				addressLines: [`The Yoga Barn`, `The Yoga Barn Ubud 80571 Indonesia`],
				venuePoint: undefined,
			},
			point: { lat: -8.5069, lng: 115.2625 },
		});

		expect(mapped).toMatchObject({
			name: `FRIDAY Ecstatic Dance`,
			startAt: `2026-10-23T19:15:00+08:00`,
			endAt: `2026-10-23T21:00:00+08:00`,
			address: [`The Yoga Barn`, `The Yoga Barn Ubud 80571 Indonesia`],
			price: `Rp 120,000`,
			host: `The Yoga Barn`,
			latitude: -8.5069,
			longitude: 115.2625,
			timezone: `Asia/Makassar`,
			source: `megatix_indonesia`,
			sourceUrl: `https://megatix.co.id/events/yoga-barn-friday-ecstatic-dance`,
			imageUrls: [`https://media.megatix.com.au/e/20551/cover.jpg`],
		});
		expect(mapped?.description).toContain(`Weekly dance.`);
	});

	it(`skips a listing without a name, start, or slug`, () => {
		const detail = { descriptionHtml: undefined, addressLines: [], venuePoint: undefined };
		const point = { lat: -8.5, lng: 115.26 };
		expect(mapMegatixEvent({ hit: hit({ name: `  ` }), detail, point })).toBeUndefined();
		expect(mapMegatixEvent({ hit: hit({ startDatetime: `` }), detail, point })).toBeUndefined();
		expect(mapMegatixEvent({ hit: hit({ slug: `` }), detail, point })).toBeUndefined();
	});
});

function hit(overrides: Partial<ReturnType<typeof baseHit>> = {}) {
	return { ...baseHit(), ...overrides };
}

function baseHit() {
	return {
		id: 1,
		name: `Ecstatic Dance`,
		slug: `ecstatic-dance`,
		promoterName: `Host`,
		venueName: `Venue` as string | undefined,
		startDatetime: `2026-10-23 19:15:00`,
		endDatetime: `2026-10-23 21:00:00` as string | undefined,
		displayPrice: `Rp 120,000` as string | undefined,
		coverUrl: `https://example.com/cover.jpg` as string | undefined,
	};
}
