import type { Page } from '@playwright/test';

export interface TestEvent {
	name?: string;
	description?: string;
	startAt?: string;
	endAt?: string;
	address?: string[];
	price?: string;
	imageUrls?: string[];
	host?: string;
	hostLink?: string | null;
	contact?: string[];
	latitude?: number | null;
	longitude?: number | null;
	tags?: string[];
	source?: string;
	sourceUrl?: string;
	slug?: string;
	hostSecret?: string;
	attendanceMode?: 'offline' | 'online' | 'offline+online';
}

function getWorkerSlugPrefix() {
	const workerIndex = process.env.TEST_WORKER_INDEX ?? process.env.TEST_PARALLEL_INDEX ?? '0';
	return `e2e-w${workerIndex}`;
}

/**
 * Creates a test event via the seed API. Slug is auto-prefixed for worker isolation.
 *
 * @example await createEvent(page, createMeditationEvent())
 */
export async function createEvent(page: Page, eventData: TestEvent = {}) {
	const prefix = getWorkerSlugPrefix();
	const slug = eventData.slug
		? `${prefix}-${eventData.slug}`
		: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

	const response = await page.request.post('/api/test/seed', {
		data: {
			action: 'createEvent',
			data: {
				...eventData,
				slug
			}
		}
	});

	if (!response.ok()) {
		const error = await response.text();
		throw new Error(`Failed to create event: ${error}`);
	}

	return response.json();
}

/**
 * Creates multiple test events in parallel.
 *
 * @example await createEvents(page, [createMeditationEvent(), createYogaEvent()])
 */
export async function createEvents(page: Page, events: TestEvent[]) {
	return Promise.all(events.map(e => createEvent(page, e)));
}

/**
 * Clears test events for the current worker by slug prefix.
 *
 * @example await clearTestEvents(page)
 */
export async function clearTestEvents(page: Page) {
	const response = await page.request.post('/api/test/seed', {
		data: {
			action: 'clearEvents',
			data: {
				slugPrefix: getWorkerSlugPrefix()
			}
		}
	});

	if (!response.ok()) {
		const error = await response.text();
		throw new Error(`Failed to clear events: ${error}`);
	}
}

/**
 * Clears all events from the database.
 *
 * @example await clearAllEvents(page)
 */
export async function clearAllEvents(page: Page) {
	const response = await page.request.post('/api/test/seed', {
		data: { action: 'clearAllEvents' }
	});

	if (!response.ok()) {
		const error = await response.text();
		throw new Error(`Failed to clear all events: ${error}`);
	}
}

export function createMeditationEvent(overrides: TestEvent = {}): TestEvent {
	return {
		name: 'Meditation Workshop',
		description: 'A peaceful meditation session',
		startAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
		address: ['Zen Center', 'Berlin'],
		price: 'Free',
		host: 'Awara Studio',
		tags: ['Meditation', 'Wellness'],
		source: 'awara',
		sourceUrl: 'https://awara.com/meditation-workshop',
		...overrides
	};
}

export function createYogaEvent(overrides: TestEvent = {}): TestEvent {
	return {
		name: 'Yoga Flow Class',
		description: 'Morning yoga flow for all levels',
		startAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
		address: ['Yoga Studio', 'Munich'],
		price: '€15',
		host: 'Heilnetz München',
		tags: ['Yoga', 'Fitness'],
		source: 'heilnetz',
		sourceUrl: 'https://heilnetz.de/yoga-flow',
		...overrides
	};
}

export function createOnlineEvent(overrides: TestEvent = {}): TestEvent {
	return {
		name: 'Online Breathwork Session',
		description: 'Virtual breathwork class via Zoom',
		startAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
		address: [],
		price: '€10',
		host: 'Tribehaus Community',
		tags: ['Breathwork', 'Online'],
		attendanceMode: 'online',
		source: 'tribehaus',
		sourceUrl: 'https://tribehaus.com/breathwork',
		...overrides
	};
}

export function createTelegramEvent(overrides: TestEvent = {}): TestEvent {
	return {
		name: 'Community Gathering',
		description: 'A community meetup shared via Telegram',
		startAt: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
		address: ['Community Space', 'Hamburg'],
		price: 'Free',
		host: 'Berlin Community',
		tags: ['Community', 'Wellness'],
		source: 'telegram',
		sourceUrl: 'https://t.me/example',
		...overrides
	};
}

export function createMultiDayEvent(overrides: TestEvent = {}): TestEvent {
	const startAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
	const endAt = new Date(startAt.getTime() + 3 * 24 * 60 * 60 * 1000);
	
	return {
		name: 'Weekend Retreat',
		description: 'A transformative weekend retreat',
		startAt: startAt.toISOString(),
		endAt: endAt.toISOString(),
		address: ['Retreat Center', 'Hamburg'],
		price: '€200',
		host: 'Sei.Jetzt Retreats',
		tags: ['Retreat', 'Wellness', 'Meditation'],
		source: 'seijetzt',
		sourceUrl: 'https://seijetzt.de/retreat',
		...overrides
	};
}
