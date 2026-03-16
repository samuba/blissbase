import { form, getRequestEvent } from '$app/server';
import { error, invalid, redirect } from '@sveltejs/kit';
import * as assets from '$lib/assets';
import { generateSlug, randomString } from '$lib/common';
import { createEventSchema, updateEventSchema, type CreateEventData } from '$lib/events.remote.common';
import { assertUserIsAllowedToEditEvent, eventAssetsCreds } from '$lib/events.remote.shared';
import { routes } from '$lib/routes';
import { db, eq, s, sql } from '$lib/server/db';
import { sendEventCreatedEmail } from '$lib/server/email';
import { geocodeAddressCached } from '$lib/server/google';
import type { SelectEvent } from '$lib/server/schema';
import type { InsertEvent } from '$lib/types';
import { E2E_TEST, GOOGLE_MAPS_API_KEY, ENDPOINT_SECRET } from '$env/static/private';
import { resolve } from '$app/paths';

export const updateEvent = form(updateEventSchema, async (data, issue) => {
	const eventFromDb = await assertUserIsAllowedToEditEvent(data.eventId, data.hostSecret);
	const formData = formDataToDbData(data);
	const [coords, uploadedImageUrls] = await Promise.all([
		geocodeAddressCached(formData.address, GOOGLE_MAPS_API_KEY),
		uploadImages({ files: data.images, slug: eventFromDb.slug })
	]);

	if (formData.address.length && !coords) {
		return invalid(issue.address(`Address was not found`));
	}

	const { imageUrls, deletedImageUrls } = getImagesForEventUpdate({
		existingImageUrls: eventFromDb.imageUrls ?? [],
		imageTokens: data.existingImageUrls,
		uploadedImageUrls
	});

	await db.transaction(async (tx) => {
		await tx.update(s.events).set({
			...formData,
			latitude: coords?.lat,
			longitude: coords?.lng,
			imageUrls,
			updatedAt: sql`now()`,
			slug: undefined,
		}).where(eq(s.events.id, eventFromDb.id));

		await tx.delete(s.eventTags).where(eq(s.eventTags.eventId, eventFromDb.id));
		if (data.tagIds?.length) {
			await tx.insert(s.eventTags).values(data.tagIds.map((tagId: number) => ({ eventId: eventFromDb.id, tagId })));
		}
	});

	if (deletedImageUrls?.length && E2E_TEST !== `true`) {
		await assets.deleteImages(deletedImageUrls, eventAssetsCreds);
	}

	redirect(303, routes.eventDetails(eventFromDb.slug));
});

export const createEvent = form(createEventSchema, async (data, issue) => {
	const { locals } = getRequestEvent();
	const userId = locals.userId;
	const userEmail = locals.jwtClaims?.email;

	if (!userId) throw error(401, `You must be signed in to create an event`);
	if (!userEmail) throw error(400, `Signed-in user does not have an email`);

	const event = formDataToDbData(data);
	const [coords, imageUrls] = await Promise.all([
		geocodeAddressCached(event.address, GOOGLE_MAPS_API_KEY),
		uploadImages({ files: data.images, slug: event.slug })
	]);

	if (event.address.length && !coords) {
		return invalid(issue.address(`Address was not found`));
	}

	let createdEvent: SelectEvent | undefined = undefined;

	await db.transaction(async (tx) => {
		const createdRows = await tx.insert(s.events).values({
			...event,
			imageUrls,
			latitude: coords?.lat,
			longitude: coords?.lng,
			authorId: userId,
			hostSecret: randomString(16),
		} satisfies InsertEvent).returning();

		createdEvent = createdRows[0];
		if (!createdEvent) throw error(500, `Failed to create event`);

		if (data.tagIds.length > 0) {
			await tx.insert(s.eventTags).values(data.tagIds.map((tagId) => ({
				eventId: createdEvent!.id,
				tagId,
			})));
		}
	});

	await sendEventCreatedEmail({
		to: userEmail,
		eventName: createdEvent!.name,
		eventSlug: createdEvent!.slug,
		startAt: createdEvent!.startAt,
		endAt: createdEvent!.endAt,
		isOnline: createdEvent!.attendanceMode === `online`,
	});

	redirect(303, routes.eventDetails(createdEvent!.slug));
});

/**
 * Maps the validated form payload to the event row shape.
 *
 * @example
 * formDataToDbData(data)
 */
function formDataToDbData(data: CreateEventData) {
	const timeZone = data.timeZone ?? `Europe/Berlin`;
	const startAt = utcDate(data.startAt, timeZone);
	const endAt = data.endAt ? utcDate(data.endAt, timeZone) : undefined;
	const address = data.address?.split(/,|\n/).map((x) => x.trim()).filter((x) => x) ?? [];
	const slug = generateSlug({ name: data.name, startAt, endAt });
	const attendanceMode = data.isOnline ? `online` : `offline`;
	const contact = data.contact ? [data.contact] : [];
	const listed = !data.isNotListed;

	return {
		...data,
		listed,
		startAt,
		endAt,
		address,
		slug,
		attendanceMode,
		contact,
		source: `website-form`,
	} satisfies InsertEvent;
}

/**
 * Uploads event images through the dedicated API endpoint.
 *
 * @example
 * await uploadImages({ files: [], slug: `demo-event` })
 */
async function uploadImages(args: UploadImagesArgs) {
	if (!args.files?.length) return [];
	const validFiles = args.files.filter((file) => !!file && file.size > 0);
	if (!validFiles.length) return [];

	const { fetch } = getRequestEvent();
	const formData = new FormData();
	formData.set(`secret`, ENDPOINT_SECRET);
	formData.set(`slug`, args.slug);

	for (const file of validFiles) {
		formData.append(`images`, file);
	}

	const response = await fetch(resolve('/api/events/images'), {
		method: `POST`,
		body: formData
	});
	if (!response.ok) {
		throw error(response.status, await getImageUploadErrorMessage(response));
	}

	const result = await response.json() as { imageUrls?: string[] };
	return result.imageUrls ?? [];
}

/**
 * Reads an endpoint error response and normalizes it into a message.
 *
 * @example
 * await getImageUploadErrorMessage(new Response());
 */
async function getImageUploadErrorMessage(response: Response) {
	try {
		const result = await response.json() as { error?: string };
		if (result.error) return result.error;
	} catch {
		// Ignore JSON parsing errors and fall back to a generic message.
	}

	return `Failed to upload event images`;
}

/**
 * Resolves the final image order for an event update and which old images should be deleted.
 *
 * @example
 * getImagesForEventUpdate({ existingImageUrls: [], imageTokens: [], uploadedImageUrls: [] })
 */
function getImagesForEventUpdate(args: GetImagesForEventUpdateArgs) {
	const remainingNewImageUrls = [...args.uploadedImageUrls];
	const imageUrls: string[] = [];

	for (const token of args.imageTokens) {
		if (token.startsWith(`new:`)) {
			const nextNewImageUrl = remainingNewImageUrls.shift();
			if (!nextNewImageUrl) continue;

			imageUrls.push(nextNewImageUrl);
			continue;
		}

		if (!args.existingImageUrls.includes(token)) continue;
		if (imageUrls.includes(token)) continue;
		imageUrls.push(token);
	}

	if (remainingNewImageUrls.length) {
		imageUrls.push(...remainingNewImageUrls);
	}

	return {
		imageUrls,
		deletedImageUrls: args.existingImageUrls.filter((x) => !imageUrls.includes(x))
	};
}

/**
 * Interprets a naive local datetime in the given timezone and returns UTC.
 *
 * @example
 * utcDate(`2026-03-12T19:00`, `Europe/Berlin`)
 */
function utcDate(localDateTime: string, timeZone: string): Date {
	return new Date(applyTimezone(localDateTime, timeZone));
}

/**
 * Interprets a naive ISO datetime string in the given IANA timezone.
 *
 * @example
 * applyTimezone(`2026-03-12T19:00`, `Europe/Berlin`)
 */
function applyTimezone(naiveDatetime: string, timeZone: string): string {
	const naive = new Date(`${naiveDatetime}Z`);
	const formatter = new Intl.DateTimeFormat(`en-CA`, {
		timeZone,
		year: `numeric`,
		month: `2-digit`,
		day: `2-digit`,
		hour: `2-digit`,
		minute: `2-digit`,
		second: `2-digit`,
		hour12: false,
	});

	const parts = formatter.formatToParts(naive);
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? `0`;
	const tzYear = parseInt(get(`year`));
	const tzMonth = parseInt(get(`month`)) - 1;
	const tzDay = parseInt(get(`day`));
	const tzHour = parseInt(get(`hour`)) % 24;
	const tzMinute = parseInt(get(`minute`));
	const tzSecond = parseInt(get(`second`));
	const tzAsUtc = Date.UTC(tzYear, tzMonth, tzDay, tzHour, tzMinute, tzSecond);
	const offsetMs = naive.getTime() - tzAsUtc;

	return new Date(naive.getTime() + offsetMs).toISOString();
}

type UploadImagesArgs = {
	files: File[];
	slug: string;
};

type GetImagesForEventUpdateArgs = {
	existingImageUrls: string[];
	imageTokens: string[];
	uploadedImageUrls: string[];
};
