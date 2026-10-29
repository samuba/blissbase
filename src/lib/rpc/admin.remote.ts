import { command, getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { asc } from 'drizzle-orm';
import * as v from 'valibot';
import { ALL_EVENT_SOURCES_VALUE, loadFiltersFromCookie, saveFiltersToCookie } from '$lib/cookie-utils';
import { parseOfferingsFilterFromUrl } from '$lib/offeringsFilter';
import { isAdminSession } from '$lib/server/admin';
import { db, s } from '$lib/server/db';
import { generateOfferingAnnouncementForUrl } from '$lib/server/offeringAnnouncement';
import {
	bustOfferingsOgImageCache,
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
		const { announcement } = await generateOfferingAnnouncementForUrl(url);
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
