import { command, getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { asc } from 'drizzle-orm';
import * as v from 'valibot';
import { ALL_EVENT_SOURCES_VALUE, loadFiltersFromCookie, saveFiltersToCookie } from '$lib/cookie-utils';
import { parseOfferingsFilterFromUrl } from '$lib/offeringsFilter';
import { isAdminSession } from '$lib/server/admin';
import { aiPickEmojisForTitles } from '$lib/server/ai';
import { db, s } from '$lib/server/db';
import {
	bustOfferingsOgImageCache,
	loadVisibleListedOfferings,
	scheduleOfferingsOgWarmForFilter,
} from '$lib/server/og/offeringsOg';

export const getEventSources = query(async () => {
	assertAdmin();

	const rows = await db
		.selectDistinct({ source: s.events.source })
		.from(s.events)
		.orderBy(asc(s.events.source));

	return rows.map((row) => row.source).filter((source) => source.trim());
});

export const getEventSourceFilter = query(async () => {
	assertAdmin();

	const { cookies } = getRequestEvent();
	const savedFilters = loadFiltersFromCookie(cookies);
	const source = savedFilters?.source?.trim() || null;
	return source ?? ALL_EVENT_SOURCES_VALUE;
});

export const setEventSourceFilter = command(
	v.object({
		source: v.string(),
	}),
	async (args) => {
		assertAdmin();

		const { cookies } = getRequestEvent();
		const savedFilters = loadFiltersFromCookie(cookies);
		const trimmed = args.source.trim();
		const source = !trimmed || trimmed === ALL_EVENT_SOURCES_VALUE ? null : trimmed;

		saveFiltersToCookie(cookies, {
			...(savedFilters ?? {}),
			source,
		});

		return { source: source ?? ALL_EVENT_SOURCES_VALUE };
	},
);

export const generateOfferingAnnouncement = command(
	v.object({
		url: v.pipe(v.string(), v.url()),
	}),
	async ({ url }) => {
		assertAdmin();

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

		const titlesNeedingEmoji = prepared
			.filter((item) => !item.existingEmoji)
			.map((item) => item.title);

		const reservedEmojis = prepared
			.map((item) => item.existingEmoji)
			.filter((emoji): emoji is string => Boolean(emoji));

		const pickedEmojis = titlesNeedingEmoji.length
			? await aiPickEmojisForTitles({ titles: titlesNeedingEmoji, reservedEmojis })
			: [];

		let pickedIndex = 0;
		const location =
			(filter.lat != null && filter.lng != null ? filter.location : null)?.trim() ||
			filter.location?.trim() ||
			`EVERYWHERE`;

		const announcement = buildOfferingAnnouncement({
			offerings: prepared.map((item) => ({
				title: item.title,
				author: item.author,
				emoji: item.existingEmoji ?? pickedEmojis[pickedIndex++]?.trim() ?? `✨`,
			})),
			location,
			url: pageUrl.href,
		});

		return { announcement };
	},
);

export const bustOfferingsOgCache = command(
	v.object({
		url: v.optional(v.pipe(v.string(), v.url())),
	}),
	async ({ url }) => {
		assertAdmin();
		const result = await bustOfferingsOgImageCache();
		if (url) {
			scheduleOfferingsOgWarmForFilter(parseOfferingsFilterFromUrl(new URL(url)));
		}
		return result;
	},
);

function assertAdmin() {
	if (isAdminSession()) return;
	error(403, `Admin only`);
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
	const match = text.match(
		/\p{Extended_Pictographic}(?:\uFE0F)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F)?)*/u,
	);
	return match?.[0] ?? null;
}

function stripEmojis(text: string) {
	return text
		.replace(/\p{Extended_Pictographic}(?:\uFE0F)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F)?)*/gu, ``)
		.replace(/\s+/g, ` `)
		.trim();
}

function buildOfferingAnnouncement({
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
