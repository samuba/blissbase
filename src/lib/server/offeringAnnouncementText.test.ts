import { describe, expect, it, vi } from "vitest";

vi.mock(`$app/paths`, () => ({
	resolve: (path: string) => path,
}));

const { BASE_URL } = await import(`$lib/routes`);
const { parseOfferingsFilterFromUrl } = await import(`$lib/offeringsFilter`);
const { buildOfferingAnnouncement, hoiAnOfferingsPageUrl } = await import(`$lib/server/offeringAnnouncementText`);

describe(`hoiAnOfferingsPageUrl`, () => {
	it(`points at the Hoi An offerings list within 50 km`, () => {
		const url = new URL(hoiAnOfferingsPageUrl());

		expect(url.origin).toBe(BASE_URL);
		expect(url.pathname).toBe(`/offerings`);
		expect(parseOfferingsFilterFromUrl(url)).toEqual({
			location: `Hoi An`,
			distance: `50`,
			lat: 15.8801,
			lng: 108.338,
			searchTerm: null,
			includeOnline: true,
		});
	});
});

describe(`buildOfferingAnnouncement`, () => {
	it(`builds the same announcement text the admin action copies`, () => {
		const url = `https://blissbase.app/offerings?location=Hoi+An&distance=50`;
		const text = buildOfferingAnnouncement({
			offerings: [
				{ title: `Tarot`, author: `Pierce`, emoji: `🃏` },
				{ title: `Sound bath`, author: `Danielle`, emoji: `🎶` },
			],
			location: `Hoi An`,
			url,
		});

		expect(text).toBe(
			`Community Offerings that you can book in Hoi An.\nCheck them out here or add your own: ${url}\n\n🃏 *Tarot*\nby Pierce\n\n🎶 *Sound bath*\nby Danielle`,
		);
	});
});
