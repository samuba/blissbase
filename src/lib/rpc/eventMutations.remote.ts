import { form, getRequestEvent } from '$app/server';
import { error, invalid, redirect } from '@sveltejs/kit';
import { ensureUserId } from '$lib/server/common';
import * as assets from '$lib/assets';
import { generateSlug, randomString } from '$lib/common';
import { createEventSchema, updateEventSchema, type CreateEventData, type ContactMethod } from '$lib/events.remote.common';
import { assertUserIsAllowedToEditEvent, eventAssetsCreds } from '$lib/events.remote.shared';
import {
	EVENT_IMAGE_ACCEPTED_MIME_TYPES,
	EVENT_IMAGE_HASH_LENGTH,
	getStableContentHash,
	getProcessedImageHashFromFileName
} from '$lib/eventImageProcessing.shared';
import { routes } from '$lib/routes';
import { db, eq, s, sql } from '$lib/server/db';
import { sendEventCreatedEmail } from '$lib/server/email';
import { geocodeAddressCached } from '$lib/server/google';
import type { SelectEvent } from '$lib/server/schema';
import type { InsertEvent } from '$lib/types';
import { E2E_TEST, GOOGLE_MAPS_API_KEY } from '$env/static/private';

export const updateEvent = form(updateEventSchema, async (data, issue) => {
	console.time('updateEvent');
	const eventFromDb = await assertUserIsAllowedToEditEvent(data.eventId, data.hostSecret);
	const address = toAddressLines(data.address);
	const [coords, uploadedImageUrls] = await Promise.all([
		geocodeAddressCached({
			addressLines: address,
			apiKey: GOOGLE_MAPS_API_KEY
		}),
		uploadImages({ files: data.images, slug: eventFromDb.slug })
	]);

	if (address.length && !coords) {
		return invalid(issue.address(`Address was not found in Google Maps`));
	}
	const formData = formDataToDbData({
		data,
		timezone: coords?.timezone ?? data.timeZone ?? `Europe/Berlin`,
		address
	});

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

	console.timeEnd('updateEvent');
	redirect(303, routes.eventDetails(eventFromDb.slug));
});

export const createEvent = form(createEventSchema, async (data, issue) => {
	console.time('createEvent');
	const { locals } = getRequestEvent();
	const userId = ensureUserId({ locals, msg: `You must be signed in to create an event` });
	const userEmail = locals.jwtClaims?.email;
	if (!userEmail) throw error(400, `Signed-in user does not have an email`);

	const address = toAddressLines(data.address);
	const coords = await geocodeAddressCached({
		addressLines: address,
		apiKey: GOOGLE_MAPS_API_KEY
	});

	if (address.length && !coords) {
		return invalid(issue.address(`Address was not found in Google Maps`));
	}
	const event = formDataToDbData({
		data,
		timezone: coords?.timezone ?? data.timeZone ?? `Europe/Berlin`,
		address
	});
	const imageUrls = await uploadImages({ files: data.images, slug: event.slug });

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

	console.timeEnd('createEvent');
	redirect(303, routes.eventDetails(createdEvent!.slug));
});

/**
 * Maps the validated form payload to the event row shape.
 * Builds `contact[]` URIs from plain form `contact` + `contactMethod` (reverse of `storedContactUriToFormFields` on load).
 *
 * @example
 * formDataToDbData({ data, timezone: `Europe/Berlin`, address: [`Berlin`] })
 */
function formDataToDbData(args: FormDataToDbDataArgs) {
	const startAt = utcDate(args.data.startAt, args.timezone);
	const endAt = args.data.endAt ? utcDate(args.data.endAt, args.timezone) : undefined;
	const slug = generateSlug({ name: args.data.name, startAt, endAt });
	const attendanceMode = args.data.isOnline ? `online` : `offline`;
	const listed = !args.data.isNotListed;
	let contact: string[] = []
	const contactMethod = args.data.contactMethod as ContactMethod;
	if (contactMethod === `email`) {
		contact = [`mailto:${args.data.contact}`];
	} else if (contactMethod === `telegram`) {
		contact = [`tg://resolve?domain=${args.data.contact}`];
	} else if (contactMethod === `whatsapp`) {
		contact = [`https://wa.me/${args.data.contact}`];
	} else if (contactMethod === `phone`) {
		contact = [`tel:${args.data.contact}`];
	} else if (contactMethod === `website`) {
		if (args.data.contact?.startsWith(`http`)) contact = [args.data.contact];
		else contact = [`https://${args.data.contact}`];
	}

	return {
		...args.data,
		listed,
		startAt,
		endAt,
		timezone: args.timezone,
		address: args.address,
		slug,
		attendanceMode,
		contact,
		source: `website-form`,
	} satisfies InsertEvent;
}

/**
 * Normalizes the free-text event address into cached address lines.
 *
 * @example
 * toAddressLines(`Studio\nBerlin`)
 */
function toAddressLines(address: string | undefined) {
	return address?.split(/,|\n/).map((x) => x.trim()).filter((x) => x) ?? [];
}

/**
 * Uploads already processed event images directly to storage.
 *
 * @example
 * await uploadImages({ files: [], slug: `demo-event` })
 */
async function uploadImages(args: UploadImagesArgs) {
	if (!args.files?.length) return [];
	const validFiles = args.files.filter((file) => !!file && file.size > 0);
	if (!validFiles.length) return [];

	if (E2E_TEST === `true`) {
		return getE2EImageUrls({ files: validFiles, slug: args.slug });
	}

	const uploadedImages = new Map<string, Promise<string>>();
	const imageUrls: string[] = [];

	for (const file of validFiles) {
		let imageHash: string | undefined = undefined;

		try {
			if (!EVENT_IMAGE_ACCEPTED_MIME_TYPES.includes(file.type as (typeof EVENT_IMAGE_ACCEPTED_MIME_TYPES)[number])) {
				throw new Error(`Expected processed image upload (WebP or JPEG), received ${file.type || `unknown`}`);
			}

			const bytes = new Uint8Array(await file.arrayBuffer());
			imageHash = getProcessedImageHashFromFileName({ fileName: file.name }) ?? await getStableContentHash({ bytes });
			if (!imageHash || imageHash.length !== EVENT_IMAGE_HASH_LENGTH) {
				throw new Error(`Missing processed image hash`);
			}

			let imageUrlPromise = uploadedImages.get(imageHash);
			if (!imageUrlPromise) {
				imageUrlPromise = assets.uploadImage(Buffer.from(bytes), args.slug, imageHash, eventAssetsCreds, file.type);
				uploadedImages.set(imageHash, imageUrlPromise);
			}

			imageUrls.push(await imageUrlPromise);
		} catch (err) {
			if (imageHash) uploadedImages.delete(imageHash);
			const message = err instanceof Error ? err.message : String(err);
			console.error(`Error uploading processed event image "${file.name}". Skipping it:`, message);
		}
	}

	return imageUrls;
}

/**
 * Builds deterministic mock image URLs for E2E without touching external storage.
 *
 * @example
 * getE2EImageUrls({ files: [], slug: `demo-event` });
 */
function getE2EImageUrls(args: UploadImagesArgs) {
	if (!args.files?.length) return [];

	return args.files.map((file, index) => {
		const safeFileName = file.name
			.replace(new RegExp(`^[A-Za-z0-9_-]{${EVENT_IMAGE_HASH_LENGTH}}-`), ``)
			.replace(/[^a-zA-Z0-9.\-_]/g, `-`);
		return `https://assets.blissbase.app/e2e/${args.slug}/${index}-${safeFileName}`;
	});
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

type FormDataToDbDataArgs = {
	data: CreateEventData;
	timezone: string;
	address: string[];
};

type GetImagesForEventUpdateArgs = {
	existingImageUrls: string[];
	imageTokens: string[];
	uploadedImageUrls: string[];
};
