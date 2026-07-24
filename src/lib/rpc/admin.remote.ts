import { command, getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { asc } from 'drizzle-orm';
import * as v from 'valibot';
import { ALL_EVENT_SOURCES_VALUE, loadFiltersFromCookie, saveFiltersToCookie } from '$lib/cookie-utils';
import { isAdminSession } from '$lib/server/admin';
import { db, s } from '$lib/server/db';

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

function assertAdmin() {
	if (isAdminSession()) return;
	error(403, `Admin only`);
}
