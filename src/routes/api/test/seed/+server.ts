import { json } from '@sveltejs/kit';
import { db, s } from '$lib/server/db';
import { sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { E2E_TEST } from '$env/static/private';
import { dev } from '$app/environment';

export const POST: RequestHandler = async ({ request }) => {
	if (E2E_TEST !== 'true' || !dev) {
		return json({ error: 'Only available in E2E mode' }, { status: 403 });
	}

	const { action, data } = await request.json();

	try {
		switch (action) {
			case 'createEvent': {
				const [event] = await db.insert(s.events).values({
					name: data.name || 'Test Event',
					description: data.description || 'Test description',
					startAt: data.startAt ? new Date(data.startAt) : new Date(Date.now() + 24 * 60 * 60 * 1000),
					endAt: data.endAt ? new Date(data.endAt) : null,
					address: data.address || ['Test Address'],
					price: data.price || 'Free',
					priceIsHtml: false,
					imageUrls: data.imageUrls || [],
					host: data.host || 'Test Host',
					hostLink: data.hostLink || null,
					contact: data.contact || [],
					latitude: data.latitude || null,
					longitude: data.longitude || null,
					tags: data.tags || ['Meditation'],
					source: data.source || 'awara',
					sourceUrl: data.sourceUrl || 'https://example.com',
					slug: data.slug || `e2e-${Date.now()}`,
					listed: true,
					soldOut: false,
					hostSecret: data.hostSecret || 'test-secret',
					attendanceMode: data.attendanceMode || 'offline',
					createdAt: new Date(),
					updatedAt: new Date()
				}).returning();
				return json({ success: true, event });
			}

			case 'clearEvents': {
				const slugPrefix = data?.slugPrefix;
				if (slugPrefix) {
					await db.delete(s.events).where(sql`${s.events.slug} LIKE ${slugPrefix + '%'}`);
				} else {
					await db.delete(s.events);
				}
				return json({ success: true });
			}

			case 'clearAllEvents':
				await db.delete(s.events);
				return json({ success: true });

			default:
				return json({ error: 'Unknown action' }, { status: 400 });
		}
	} catch (error) {
		console.error('Seed error:', error);
		return json({ error: String(error) }, { status: 500 });
	}
};
