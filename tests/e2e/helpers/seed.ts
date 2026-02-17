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

function getWorkerTestSource() {
	const workerIndex = process.env.TEST_WORKER_INDEX ?? process.env.TEST_PARALLEL_INDEX ?? '0';
	return `test-worker-${workerIndex}`;
}

export async function createEvent(page: Page, eventData: TestEvent = {}) {
	const source = eventData.source ?? getWorkerTestSource();

	const response = await page.request.post('/api/test/seed', {
		data: {
			action: 'createEvent',
			data: {
				...eventData,
				source
			}
		}
	});

	if (!response.ok()) {
		const error = await response.text();
		throw new Error(`Failed to create event: ${error}`);
	}

	return response.json();
}

export async function createEvents(page: Page, events: TestEvent[]) {
	return Promise.all(events.map(e => createEvent(page, e)));
}

export async function clearTestEvents(page: Page) {
	const response = await page.request.post('/api/test/seed', {
		data: {
			action: 'clearEvents',
			data: {
				source: getWorkerTestSource()
			}
		}
	});

	if (!response.ok()) {
		const error = await response.text();
		throw new Error(`Failed to clear events: ${error}`);
	}
}

export async function clearAllEvents(page: Page) {
	const response = await page.request.post('/api/test/seed', {
		data: { action: 'clearAllEvents' }
	});

	if (!response.ok()) {
		const error = await response.text();
		throw new Error(`Failed to clear all events: ${error}`);
	}
}

// Common test event factories
export function createMeditationEvent(overrides: TestEvent = {}): TestEvent {
	return {
		name: 'Meditation Workshop',
		description: 'A peaceful meditation session',
		startAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
		address: ['Zen Center', 'Berlin'],
		price: 'Free',
		tags: ['Meditation', 'Wellness'],
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
		tags: ['Yoga', 'Fitness'],
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
		tags: ['Breathwork', 'Online'],
		attendanceMode: 'online',
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
		tags: ['Retreat', 'Wellness', 'Meditation'],
		...overrides
	};
}
