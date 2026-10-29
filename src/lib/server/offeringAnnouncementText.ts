import { absoluteUrl, routes } from "$lib/routes";

/** 50 km around Hoi An — the location picker's default radius. Coordinates match the Hoi An catalog entry. */
const HOI_AN_OFFERINGS_FILTER = {
	location: `Hoi An`,
	distance: `50`,
	lat: 15.8801,
	lng: 108.338,
} as const;

/** Absolute offerings URL the weekly Hoi An announcement is generated from. */
export function hoiAnOfferingsPageUrl() {
	return absoluteUrl(routes.offeringsList(HOI_AN_OFFERINGS_FILTER));
}

export function buildOfferingAnnouncement({
	offerings,
	location,
	url,
}: {
	offerings: { title: string; author: string; emoji: string }[];
	location: string;
	url: string;
}) {
	const header = `Community Offerings that you can book in ${location}.\nCheck them out here or add your own: ${url}`;
	const parts = offerings.map((offering) => {
		return `${offering.emoji} *${offering.title}*\nby ${offering.author}`;
	});
	return `${header}\n\n${parts.join(`\n\n`)}`;
}
