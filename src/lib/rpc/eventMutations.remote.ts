import { form, getRequestEvent, query } from '$app/server';
import { E2E_TEST, GOOGLE_MAPS_API_KEY } from '$env/static/private';
import * as assets from '$lib/assets';
import { deduplicateItems, generateSlug, randomString, toAddressLines } from '$lib/common';
import {
    IMAGE_UPLOAD_ACCEPTED_MIME_TYPES,
    IMAGE_UPLOAD_HASH_LENGTH,
    getProcessedImageHashFromFileName,
    getStableContentHash
} from '$lib/imageUpload.shared';
import { createEventSchema, updateEventSchema, type ContactMethod, type CreateEventData } from '$lib/events.remote.common';
import { coordinatesMatch, hasValidCoordinates } from '$lib/locationFilter';
import { assertUserIsAllowedToEditEvent, eventAssetsCreds } from '$lib/events.remote.shared';
import { routes, withEventSlug } from '$lib/routes';
import { db, eq, s, sql } from '$lib/server/db';
import { sendEventCreatedEmail } from '$lib/server/email';
import { geocodeAddressCached, getTimezoneForCoordinatesCached } from '$lib/server/google';
import { isPublicProfile } from '$lib/server/profile';
import { hasPublicProfileChanges, mergeProfileFromForm, savePublicProfile } from '$lib/server/savePublicProfile';
import { verifySubmitAuthToken } from '$lib/server/submitAuth';
import { getMyPublicProfile } from '$lib/rpc/profile.remote';
import { setFlash } from '$lib/server/flash';
import type { SelectEvent } from '$lib/server/schema';
import type { InsertEvent } from '$lib/types';
import { error, invalid, redirect } from '@sveltejs/kit';
import * as v from 'valibot';

export const updateEvent = form(updateEventSchema, async (data, issue) => {
	console.time('updateEvent');
	const eventFromDb = await assertUserIsAllowedToEditEvent(data.eventId, data.hostSecret);
	const address = toAddressLines(data.address);
	const [coords, uploadedImageUrls] = await Promise.all([
		resolveEventCoordinates({
			address: data.address,
			latitude: data.latitude,
			longitude: data.longitude,
		}),
		uploadImages({ files: data.images, slug: eventFromDb.slug })
	]);

	if (address.length && !coords) {
		return invalid(issue.address(`Address was not found in Google Maps`));
	}
	const formData = formDataToDbData({
		data,
		timezone: resolveUpdateTimezone({
			coords,
			previousLat: eventFromDb.latitude,
			previousLng: eventFromDb.longitude,
			previousTimezone: eventFromDb.timezone,
			formTimeZone: data.timeZone,
		}),
		address
	});

	const { imageUrls, deletedImageUrls } = getImagesForEventUpdate({
		existingImageUrls: eventFromDb.imageUrls ?? [],
		imageTokens: data.existingImageUrls,
		uploadedImageUrls
	});

	await db.update(s.events).set({
		...formData,
		latitude: coords?.lat,
		longitude: coords?.lng,
		imageUrls: deduplicateItems(imageUrls),
		updatedAt: sql`now()`,
	}).where(eq(s.events.id, eventFromDb.id));

	if (deletedImageUrls?.length && E2E_TEST !== `true`) {
		await assets.deleteObjects(deletedImageUrls, eventAssetsCreds);
	}

	console.timeEnd('updateEvent');
	setFlash(`eventUpdated`);
	redirect(303, routes.eventDetails(eventFromDb.slug));
});

export const createEvent = form(createEventSchema, async (data, issue) => {
	console.time('createEvent');
	const { locals } = getRequestEvent();
	const sessionUserId = locals.userId;
	const userId = sessionUserId ? sessionUserId : verifySubmitAuthToken(data.authToken);
	if (!userId) return invalid(issue.email(`Bitte bestätige deine E-Mail erneut.`));

	const userEmail = locals.jwtClaims?.email || data.email;
	if (!userEmail) {
		return invalid(issue.email(sessionUserId ? `Signed-in user does not have an email` : `Bitte gib deine E-Mail-Adresse ein.`));
	}

	const currentProfile = await db.query.profiles.findFirst({ where: eq(s.profiles.id, userId) });
	if (!currentProfile) throw error(404, `Profile not found`);
	const nextProfile = await mergeProfileFromForm({
		currentProfile,
		data: data.profile ?? {},
		issue,
	});
	if (!isPublicProfile(nextProfile)) {
		return invalid(issue.profile.displayName(`Bitte vervollständige dein öffentliches Profil.`));
	}
	if (hasPublicProfileChanges({ current: currentProfile, next: nextProfile })) {
		await savePublicProfile(nextProfile);
		if (sessionUserId) getMyPublicProfile().refresh();
	}

	const address = toAddressLines(data.address);
	const coords = await resolveEventCoordinates({
		address: data.address,
		latitude: data.latitude,
		longitude: data.longitude,
	});

	if (address.length && !coords) {
		return invalid(issue.address(`Address was not found in Google Maps`));
	}
	const timezone = coords?.timezone ?? data.timeZone ?? `Europe/Berlin`;
	const event = formDataToDbData({ data, timezone, address });
	const slug = getEventSlugForDraft({
		name: event.name,
		startAt: data.startAt,
		endAt: data.endAt,
		timezone
	});
	const imageUrls = await uploadImages({ files: data.images, slug });

	let createdEvent: SelectEvent | undefined = undefined;
	
	const existingEvent = await db.query.events.findFirst({ where: eq(s.events.slug, slug), columns: { slug: true } });
	if (existingEvent) {
		return invalid(issue.name(`An event with this name and start date already exists.`));
	}

	const createdRows = await db.insert(s.events).values({
		...event,
		source: `website-form`,
		slug,
		imageUrls: deduplicateItems(imageUrls),
		latitude: coords?.lat,
		longitude: coords?.lng,
		authorId: userId,
		hostSecret: randomString(16),
	} satisfies InsertEvent).returning();

	createdEvent = createdRows[0];
	if (!createdEvent) throw error(500, `Failed to create event`);

	if (E2E_TEST !== `true`) {
		await sendEventCreatedEmail({
			to: userEmail,
			eventName: createdEvent!.name,
			eventSlug: createdEvent!.slug,
			startAt: createdEvent!.startAt,
			endAt: createdEvent!.endAt,
			isOnline: createdEvent!.attendanceMode === `online`,
		});
	}

	console.timeEnd('createEvent');
	setFlash(`eventCreated`);
	redirect(303, withEventSlug({ eventSlug: createdEvent!.slug }));
});

export const getExistingEventForDraft = query(v.object({
	name: v.pipe(v.string(), v.trim(), v.nonEmpty()),
	startAt: v.pipe(v.string(), v.isoDateTime()),
	endAt: v.optional(v.pipe(v.string(), v.isoDateTime())),
	timeZone: v.pipe(v.string(), v.trim(), v.nonEmpty())
}), async (draft) => {
	const slug = getEventSlugForDraft({
		name: draft.name,
		startAt: draft.startAt,
		endAt: draft.endAt,
		timezone: draft.timeZone
	});
	const existingEvent = await db.query.events.findFirst({
		where: eq(s.events.slug, slug),
		columns: { slug: true }
	});

	return { slug: existingEvent?.slug };
});

/**
 * Computes the canonical event slug from draft form values before persisting.
 *
 * @example
 * getEventSlugForDraft({ name: `Ecstatic Dance`, startAt: `2026-03-12T19:00`, endAt: `2026-03-12T22:00`, timeZone: `Europe/Berlin` })
 */
function getEventSlugForDraft(args: {
	name: string;
	startAt: string;
	endAt?: string;
	timezone: string;
}) {
	const startAt = utcDate(args.startAt, args.timezone);
	const endAt = args.endAt ? utcDate(args.endAt, args.timezone) : undefined;
	return generateSlug({ name: args.name, startAt, endAt });
}

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

	const {
		email: _email,
		authToken: _authToken,
		profile: _profile,
		images: _images,
		isOnline: _isOnline,
		isNotListed: _isNotListed,
		contact: _contact,
		contactMethod: _contactMethod,
		startAt: _startAt,
		endAt: _endAt,
		timeZone: _timeZone,
		addressNote: _addressNote,
		latitude: _latitude,
		longitude: _longitude,
		...eventFields
	} = args.data as CreateEventData & {
		eventId?: number;
		hostSecret?: string;
		existingImageUrls?: string[];
	};

	return {
		...eventFields,
		listed,
		startAt,
		endAt,
		timezone: args.timezone,
		address: args.address,
		addressNote: args.data.addressNote?.trim() || null,
		attendanceMode,
		contact,
	} satisfies Omit<InsertEvent, 'source' | 'slug'>;
}

/**
 * Prefers the place timezone; if lookup fails, keep the stored zone unless the venue moved.
 *
 * @example
 * resolveUpdateTimezone({
 *   coords: { lat: 52.52, lng: 13.405, timezone: null },
 *   previousLat: 52.52,
 *   previousLng: 13.405,
 *   previousTimezone: `Europe/Berlin`,
 *   formTimeZone: `Europe/Berlin`,
 * })
 */
function resolveUpdateTimezone(args: {
	coords: { lat: number; lng: number; timezone: string | null } | null;
	previousLat?: number | null;
	previousLng?: number | null;
	previousTimezone?: string | null;
	formTimeZone?: string;
}) {
	if (args.coords?.timezone) return args.coords.timezone;

	const venueMoved = Boolean(args.coords) && !coordinatesMatch({
		a: { lat: args.coords?.lat, lng: args.coords?.lng },
		b: { lat: args.previousLat, lng: args.previousLng },
	});
	if (venueMoved) return args.formTimeZone ?? args.previousTimezone ?? `Europe/Berlin`;
	return args.previousTimezone ?? args.formTimeZone ?? `Europe/Berlin`;
}

/**
 * Uses Places coordinates when the user picked a suggestion, otherwise geocodes the label.
 *
 * @example
 * await resolveEventCoordinates({ address: `Berlin`, latitude: 52.52, longitude: 13.405 })
 */
async function resolveEventCoordinates(args: {
	address?: string;
	latitude?: number | null;
	longitude?: number | null;
}) {
	if (hasValidCoordinates({ lat: args.latitude, lng: args.longitude })) {
		const lat = args.latitude as number;
		const lng = args.longitude as number;
		if (E2E_TEST === `true`) return { lat, lng, timezone: null };
		return {
			lat,
			lng,
			timezone: await getTimezoneForCoordinatesCached({
				lat,
				lng,
				apiKey: GOOGLE_MAPS_API_KEY,
			}),
		};
	}

	const label = args.address?.trim();
	if (!label) return null;

	return geocodeAddressCached({
		addressLines: [label],
		apiKey: GOOGLE_MAPS_API_KEY,
	});
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
			if (!IMAGE_UPLOAD_ACCEPTED_MIME_TYPES.includes(file.type as (typeof IMAGE_UPLOAD_ACCEPTED_MIME_TYPES)[number])) {
				throw new Error(`Expected processed image upload (WebP or JPEG), received ${file.type || `unknown`}`);
			}

			const bytes = new Uint8Array(await file.arrayBuffer());
			imageHash = getProcessedImageHashFromFileName({ fileName: file.name }) ?? await getStableContentHash({ bytes });
			if (!imageHash || imageHash.length !== IMAGE_UPLOAD_HASH_LENGTH) {
				throw new Error(`Missing processed image hash`);
			}

			let imageUrlPromise = uploadedImages.get(imageHash);
			if (!imageUrlPromise) {
				imageUrlPromise = assets.uploadEventImage(Buffer.from(bytes), args.slug, imageHash, eventAssetsCreds, file.type);
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
			.replace(new RegExp(`^[A-Za-z0-9_-]{${IMAGE_UPLOAD_HASH_LENGTH}}-`), ``)
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

	const normalizedImageUrls = deduplicateItems(imageUrls);
	return {
		imageUrls: normalizedImageUrls,
		deletedImageUrls: args.existingImageUrls.filter((x) => !normalizedImageUrls.includes(x))
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
	data: Omit<CreateEventData, `email` | `authToken` | `profile`>;
	timezone: string;
	address: string[];
};

type GetImagesForEventUpdateArgs = {
	existingImageUrls: string[];
	imageTokens: string[];
	uploadedImageUrls: string[];
};
