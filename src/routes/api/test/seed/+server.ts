import { json } from '@sveltejs/kit';
import { db, s } from '$lib/server/db';
import type { RequestHandler } from './$types';

// Test data seeding endpoint - only available in E2E mode
export const POST: RequestHandler = async ({ request }) => {
	if (process.env.E2E_TEST !== 'true') {
		return json({ error: 'Only available in E2E mode' }, { status: 403 });
	}

	const { action, data } = await request.json();

	try {
		switch (action) {
			case 'createEvent':
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
					source: data.source || 'test',
					sourceUrl: data.sourceUrl || 'https://example.com',
					slug: data.slug || `test-event-${Date.now()}`,
					listed: true,
					soldOut: false,
					hostSecret: data.hostSecret || 'test-secret',
					attendanceMode: data.attendanceMode || 'offline',
					createdAt: new Date(),
					updatedAt: new Date()
				}).returning();
				return json({ success: true, event });

			case 'clearEvents':
				await db.delete(s.events).where(sql`${s.events.source} = 'test'`);
				return json({ success: true });

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

// Helper for raw SQL queries in tests
import { sql } from 'drizzle-orm';
export { sql };
