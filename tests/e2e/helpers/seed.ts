import type { Page } from "@playwright/test";
import { E2E_OTP_CODE, getE2EUserIdForEmail } from "../../../src/lib/server/e2eAuth";

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
	attendanceMode?: "offline" | "online" | "offline+online";
}

export const E2E_DEFAULT_USER_ID = `00000000-0000-4000-8000-000000000001`;
export const E2E_DEFAULT_USER_EMAIL = `e2e-user@example.com`;
export const E2E_OTHER_USER_ID = `00000000-0000-4000-8000-000000000002`;
export const E2E_OTHER_USER_EMAIL = `e2e-other@example.com`;
export { E2E_OTP_CODE, getE2EUserIdForEmail };

function getWorkerSlugPrefix() {
	const workerIndex = process.env.TEST_WORKER_INDEX ?? process.env.TEST_PARALLEL_INDEX ?? "0";
	return `e2e-w${workerIndex}`;
}

/**
 * Creates a test event via the seed API. Slug is auto-prefixed for worker isolation.
 *
 * @example await createEvent(page, createMeditationEvent())
 */
export async function createEvent(page: Page, eventData: TestEvent = {}) {
	const prefix = getWorkerSlugPrefix();
	const slug = eventData.slug ? `${prefix}-${eventData.slug}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

	const response = await page.request.post("/api/test/seed", {
		data: {
			action: "createEvent",
			data: {
				...eventData,
				slug,
			},
		},
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
	return Promise.all(events.map((e) => createEvent(page, e)));
}

/**
 * Clears test events for the current worker by slug prefix.
 *
 * @example await clearTestEvents(page)
 */
export async function clearTestEvents(page: Page) {
	const response = await page.request.post("/api/test/seed", {
		data: {
			action: "clearEvents",
			data: {
				slugPrefix: getWorkerSlugPrefix(),
			},
		},
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
	const response = await page.request.post("/api/test/seed", {
		data: { action: "clearAllEvents" },
	});

	if (!response.ok()) {
		const error = await response.text();
		throw new Error(`Failed to clear all events: ${error}`);
	}
}

/**
 * Loads a seeded event by id through the test seed API.
 *
 * @example
 * await getEventById(page, 1);
 */
export async function getEventById(page: Page, id: number) {
	const response = await page.request.post("/api/test/seed", {
		data: {
			action: "getEventById",
			data: { id },
		},
	});

	if (!response.ok()) {
		const error = await response.text();
		throw new Error(`Failed to get event: ${error}`);
	}

	return response.json();
}

export function createMeditationEvent(overrides: TestEvent = {}): TestEvent {
	return {
		name: "Meditation Workshop",
		description: "A peaceful meditation session",
		startAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
		address: ["Zen Center", "Berlin"],
		price: "Free",
		host: "Tribehaus Studio",
		tags: ["Meditation", "Wellness"],
		source: "tribehaus",
		sourceUrl: "https://tribehaus.org/meditation-workshop",
		...overrides,
	};
}

export function createYogaEvent(overrides: TestEvent = {}): TestEvent {
	return {
		name: "Yoga Flow Class",
		description: "Morning yoga flow for all levels",
		startAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
		address: ["Yoga Studio", "Munich"],
		price: "€15",
		host: "Heilnetz München",
		tags: ["Yoga", "Fitness"],
		source: "heilnetz",
		sourceUrl: "https://heilnetz.de/yoga-flow",
		...overrides,
	};
}

export function createOnlineEvent(overrides: TestEvent = {}): TestEvent {
	return {
		name: "Online Breathwork Session",
		description: "Virtual breathwork class via Zoom",
		startAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
		address: [],
		price: "€10",
		host: "Tribehaus Community",
		tags: ["Breathwork", "Online"],
		attendanceMode: "online",
		source: "tribehaus",
		sourceUrl: "https://tribehaus.com/breathwork",
		...overrides,
	};
}

export function createTelegramEvent(overrides: TestEvent = {}): TestEvent {
	return {
		name: "Community Gathering",
		description: "A community meetup shared via Telegram",
		startAt: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
		address: ["Community Space", "Hamburg"],
		price: "Free",
		host: "Berlin Community",
		tags: ["Community", "Wellness"],
		source: "telegram",
		sourceUrl: "https://t.me/example",
		...overrides,
	};
}

export function createMultiDayEvent(overrides: TestEvent = {}): TestEvent {
	const startAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
	const endAt = new Date(startAt.getTime() + 3 * 24 * 60 * 60 * 1000);

	return {
		name: "Weekend Retreat",
		description: "A transformative weekend retreat",
		startAt: startAt.toISOString(),
		endAt: endAt.toISOString(),
		address: ["Retreat Center", "Hamburg"],
		price: "€200",
		host: "Sei.Jetzt Retreats",
		tags: ["Retreat", "Wellness", "Meditation"],
		source: "seijetzt",
		sourceUrl: "https://seijetzt.de/retreat",
		...overrides,
	};
}

export async function createProfile(page: Page, data: TestProfile = {}) {
	const response = await callSeed(page, `createProfile`, data);
	return response.profile;
}

export async function createOffering(page: Page, data: TestOffering = {}) {
	const prefix = `${getWorkerSlugPrefix()}-offering`;
	const slug = data.slug ? `${prefix}-${data.slug}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
	const response = await callSeed(page, `createOffering`, { ...data, slug });
	return response.offering;
}

export async function clearTestOfferings(page: Page) {
	await callSeed(page, `clearOfferings`, {
		slugPrefix: `${getWorkerSlugPrefix()}-offering`,
	});
}

export async function clearTestProfiles(page: Page, profileIds: string[]) {
	if (!profileIds?.length) return;
	await callSeed(page, `clearProfiles`, { profileIds });
}

export async function getProfileById(page: Page, id: string) {
	const response = await callSeed(page, `getProfileById`, { id });
	return response.profile;
}

export async function getOfferingById(page: Page, id: number) {
	const response = await callSeed(page, `getOfferingById`, { id });
	return response.offering;
}

export async function getOfferingBySlug(page: Page, slug: string) {
	const response = await callSeed(page, `getOfferingBySlug`, { slug });
	return response.offering;
}

export function createCompleteProfile(overrides: TestProfile = {}): TestProfile {
	return {
		id: E2E_DEFAULT_USER_ID,
		slug: `e2e-user`,
		displayName: `E2E User`,
		bio: `E2E profile bio`,
		profileImageUrl: `https://assets.blissbase.app/e2e/profile.webp`,
		bannerImageUrl: `https://assets.blissbase.app/e2e/banner.webp`,
		socialLinks: [{ type: `website`, value: `https://example.com` }],
		locationLabel: `Berlin`,
		latitude: 52.52,
		longitude: 13.405,
		...overrides,
	};
}

export function createIncompleteProfile(overrides: TestProfile = {}): TestProfile {
	return {
		id: E2E_DEFAULT_USER_ID,
		slug: null,
		displayName: null,
		bio: null,
		profileImageUrl: null,
		bannerImageUrl: null,
		socialLinks: [],
		locationLabel: null,
		latitude: null,
		longitude: null,
		...overrides,
	};
}

export function createOtherCompleteProfile(overrides: TestProfile = {}): TestProfile {
	return createCompleteProfile({
		id: E2E_OTHER_USER_ID,
		slug: `e2e-other`,
		displayName: `E2E Other User`,
		...overrides,
	});
}

export function createOfflineOffering(overrides: TestOffering = {}): TestOffering {
	return {
		profileId: E2E_DEFAULT_USER_ID,
		title: `Berlin Coaching Session`,
		descriptionHtml: `<p>Personal coaching in Berlin.</p>`,
		format: `offline`,
		listed: true,
		...overrides,
	};
}

export function createOnlineOffering(overrides: TestOffering = {}): TestOffering {
	return {
		profileId: E2E_DEFAULT_USER_ID,
		title: `Online Breathwork`,
		descriptionHtml: `<p>Virtual breathwork session.</p>`,
		format: `online`,
		listed: true,
		...overrides,
	};
}

async function callSeed(page: Page, action: string, data?: unknown) {
	const response = await page.request.post(`/api/test/seed`, {
		data: { action, data },
	});
	if (response.ok()) return response.json();

	const error = await response.text();
	throw new Error(`Seed action ${action} failed: ${error}`);
}

export type TestProfile = {
	id?: string;
	slug?: string | null;
	displayName?: string | null;
	bio?: string | null;
	locale?: string;
	profileImageUrl?: string | null;
	bannerImageUrl?: string | null;
	socialLinks?: Array<{ type: `instagram` | `facebook` | `website` | `telegram` | `whatsapp`; value: string }>;
	locationLabel?: string | null;
	latitude?: number | null;
	longitude?: number | null;
};

export type TestOffering = {
	profileId?: string;
	slug?: string;
	title?: string;
	descriptionHtml?: string;
	format?: `offline` | `online` | `offline+online`;
	imageUrls?: string[];
	listed?: boolean;
};
