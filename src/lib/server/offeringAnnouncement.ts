import { error } from "@sveltejs/kit";
import { parseOfferingsFilterFromUrl } from "$lib/offeringsFilter";
import { aiPickEmojisForTitles } from "$lib/server/ai";
import { loadVisibleListedOfferings } from "$lib/server/og/offeringsOg";
import { buildOfferingAnnouncement } from "$lib/server/offeringAnnouncementText";

/**
 * Same announcement the admin "Generate announcement" action builds for an offerings page URL.
 *
 * @example
 * await generateOfferingAnnouncementForUrl(`https://blissbase.app/offerings?location=Hoi+An&distance=50`)
 */
export async function generateOfferingAnnouncementForUrl(url: string) {
	const pageUrl = new URL(url);
	const { filter, offerings } = await loadVisibleListedOfferings(parseOfferingsFilterFromUrl(pageUrl));

	if (!offerings.length) {
		error(400, `No visible offerings to announce`);
	}

	const shuffled = shuffleItems(offerings);
	const prepared = shuffled.map((offering) => {
		const existingEmoji = extractFirstEmoji(offering.title);
		const title = stripEmojis(offering.title) || offering.title;
		return {
			title,
			author: offering.profile.displayName ?? ``,
			existingEmoji,
		};
	});

	const titlesNeedingEmoji = prepared.filter((item) => !item.existingEmoji).map((item) => item.title);

	const reservedEmojis = prepared.map((item) => item.existingEmoji).filter((emoji): emoji is string => Boolean(emoji));

	const pickedEmojis = titlesNeedingEmoji.length ? await aiPickEmojisForTitles({ titles: titlesNeedingEmoji, reservedEmojis }) : [];

	let pickedIndex = 0;
	const location = (filter.lat != null && filter.lng != null ? filter.location : null)?.trim() || filter.location?.trim() || `EVERYWHERE`;

	const announcement = buildOfferingAnnouncement({
		offerings: prepared.map((item) => ({
			title: item.title,
			author: item.author,
			emoji: item.existingEmoji ?? pickedEmojis[pickedIndex++]?.trim() ?? `✨`,
		})),
		location,
		url: pageUrl.href,
	});

	return {
		announcement,
		location,
		url: pageUrl.href,
		offeringCount: offerings.length,
	};
}

function shuffleItems<T>(items: T[]) {
	const result = [...items];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[result[i], result[j]] = [result[j]!, result[i]!];
	}
	return result;
}

function extractFirstEmoji(text: string) {
	const match = text.match(/\p{Extended_Pictographic}(?:\uFE0F)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F)?)*/u);
	return match?.[0] ?? null;
}

function stripEmojis(text: string) {
	return text
		.replace(/\p{Extended_Pictographic}(?:\uFE0F)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F)?)*/gu, ``)
		.replace(/\s+/g, ` `)
		.trim();
}
