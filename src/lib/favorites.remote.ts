import * as v from 'valibot';
import { query, command } from '$app/server';
import { getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { events, favorites } from '$lib/server/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { eventWith, prepareEventsForUi } from './server/events';

export const getFavoriteEventIds = query(async () => {
	const userId = getRequestEvent().locals.userId;
	if (!userId) return []; // returning empty array because not logged in users should still be able to call this

	console.time('getFavorites');
	try {
		const userFavorites = await favoriteEventIdsQuery(userId)

		return userFavorites.map((f) => f.eventId);
	} catch (err) {
		console.error(`Failed to fetch favorites:`, err);
		error(500, `Failed to fetch favorites`);
	} finally {
		console.timeEnd('getFavorites');
	}
});

export const addFavorite = command(v.number(), async (eventId) => {
	const userId = ensureUserId();
	console.time('addFavorite');
	try {
		await db.insert(favorites).values({ userId, eventId }).onConflictDoNothing();
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
		getFavoriteEvents().refresh();
	} catch (err) {
		console.error(`Failed to remove favorite:`, err);
		error(500, `Failed to remove favorite`);
	} finally {
		console.timeEnd('removeFavorite');
	}
});

export const getFavoriteEvents = query(async () => {
	const userId = ensureUserId();
	const favoriteEvents = await db.query.events.findMany({
		where: inArray(events.id, favoriteEventIdsQuery(userId)),
		with: eventWith
	});
	return prepareEventsForUi(favoriteEvents);
});

function favoriteEventIdsQuery(userId: string) {
	return db.select({ eventId: favorites.eventId }).from(favorites).where(eq(favorites.userId, userId));
}

function ensureUserId() {
	const userId = getRequestEvent().locals.jwtClaims?.sub;
	if (!userId) error(401, `Unauthorized`);
	return userId;
}
