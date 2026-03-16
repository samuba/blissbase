import { createEventSchema, updateEventSchema } from '$lib/events.remote.common';
import { describe, expect, it } from 'vitest';
import * as v from 'valibot';

describe(`event schemas`, () => {
	it(`requires a future start date when creating an event`, () => {
		const result = v.safeParse(createEventSchema, createEventPayload({
			startAt: `2024-01-15T18:00`
		}));

		expect(result.success).toBe(false);
		expect(result.issues?.some((issue) => issue.message === `Startdatum muss in der Zukunft liegen`)).toBe(true);
	});

	it(`allows updating an event that already started`, () => {
		const result = v.safeParse(updateEventSchema, {
			...createEventPayload({
				startAt: `2024-01-15T18:00`,
				description: `Aktualisierte Beschreibung`
			}),
			eventId: 42,
			hostSecret: ``,
			existingImageUrls: []
		});

		expect(result.success).toBe(true);
	});
});

/**
 * Creates a valid event payload for schema tests.
 * @example
 * createEventPayload({ description: `Updated text` });
 */
function createEventPayload(overrides: Partial<CreateEventPayload> = {}): CreateEventPayload {
	return {
		name: `Test Event`,
		description: `Test Beschreibung`,
		tagIds: [`1`],
		price: `10 EUR`,
		address: `Musterstraße 1\nBerlin`,
		startAt: `2099-01-15T18:00`,
		endAt: `2099-01-15T20:00`,
		timeZone: `Europe/Berlin`,
		isOnline: false,
		isNotListed: false,
		contact: `test@example.com`,
		contactMethod: `email`,
		images: [],
		...overrides
	};
}

type CreateEventPayload = {
	name: string;
	description: string;
	tagIds: string[];
	price?: string;
	address?: string;
	startAt: string;
	endAt?: string;
	timeZone?: string;
	isOnline: boolean;
	isNotListed: boolean;
	contact?: string;
	contactMethod?: string;
	images: File[];
};
