import * as v from 'valibot';
import { query, command } from '$app/server';
import { getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { ensureUserId } from '$lib/server/common';
import { db, s } from '$lib/server/db';
import { favorites } from '$lib/server/schema';
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { eventWith, prepareEventsForUi } from '$lib/server/events';

export const getFavoriteEventIds = query(async () => {
	const userId = getRequestEvent().locals.userId;
	if (!userId) return []; // returning empty array because not logged in users should still be able to call this

	console.time('getFavorites');
	try {
		const userFavorites = await favoriteEventIdsQuery(userId)

		console.timeEnd('getFavorites');
		return userFavorites.map((f) => f.eventId);
	} catch (err) {
		console.error(`Failed to fetch favorites:`, err);
		error(500, `Failed to fetch favorites`);
	} 
});

export const addFavorite = command(v.number(), async (eventId) => {
	const userId = ensureUserId();
	console.time('addFavorite');
	try {
		await db.insert(favorites).values({ userId, eventId }).onConflictDoNothing();
		getFavoriteEventIds().refresh();
	} catch (err) {
		console.error(`Failed to add favorite:`, err);
		error(500, `Failed to add favorite`);
	} finally {
		console.timeEnd('addFavorite');
	}
});

export const removeFavorite = command(v.number(), async (eventId) => {
	const userId = ensureUserId();
	console.time('removeFavorite');
	try {
		await db
			.delete(favorites)
			.where(and(eq(favorites.userId, userId), eq(favorites.eventId, eventId)));
		getFavoriteEventIds().refresh();
	} catch (err) {
		console.error(`Failed to remove favorite:`, err);
		error(500, `Failed to remove favorite`);
	} finally {
		console.timeEnd('removeFavorite');
	}
});

export const getFavoriteUpcomingEvents = query(async () => {
	const userId = ensureUserId();
	const endsAtOrDefault = sql<Date>`COALESCE(${s.events.endAt}, ${s.events.startAt} + interval '4 hours')`;

	const favoriteEvents = await db.query.events.findMany({
		where: and(
			inArray(s.events.id, favoriteEventIdsQuery(userId)),
			gte(endsAtOrDefault, sql`NOW()`)
		),
		with: eventWith,
		orderBy: [asc(s.events.startAt), asc(s.events.id)]
	});
	return prepareEventsForUi(favoriteEvents);
});

export const getFavoritePastEvents = query(async () => {
	const userId = ensureUserId();
	const endsAtOrDefault = sql<Date>`COALESCE(${s.events.endAt}, ${s.events.startAt} + interval '4 hours')`;

	const favoriteEvents = await db.query.events.findMany({
		where: and(
			inArray(s.events.id, favoriteEventIdsQuery(userId)),
			lt(endsAtOrDefault, sql`NOW()`)
		),
		with: eventWith,
		orderBy: [desc(s.events.startAt), desc(s.events.id)]
	});
	return prepareEventsForUi(favoriteEvents);
});

function favoriteEventIdsQuery(userId: string) {
	return db.select({ eventId: favorites.eventId }).from(favorites).where(eq(favorites.userId, userId));
}
