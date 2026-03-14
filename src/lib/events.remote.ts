import { fetchEvents, loadEventsParamsSchema, prepareEventsResultForUi } from "$lib/server/events";
import { loadFiltersFromCookie, saveFiltersToCookie } from "$lib/cookie-utils";
import { getRequestEvent, command, form, query, prerender } from '$app/server';
import * as v from 'valibot';
import { db, eq, s, sql } from "./server/db";
import { error, invalid, redirect } from "@sveltejs/kit";
import { isAdminSession } from "$lib/server/admin";
import { posthogCapture } from "$lib/server/common";
import * as assets from '$lib/assets';
import { resizeCoverImage } from '$lib/imageProcessing';
import { routes } from '$lib/routes';
import { createEventSchema, updateEventSchema,type CreateEventData } from "./events.remote.common";
import { generateSlug,randomString } from "./common";
import type { InsertEvent } from "./types";
import type { SelectEvent } from "./server/schema";
import {S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET_NAME, CLOUDFLARE_ACCOUNT_ID,GOOGLE_MAPS_API_KEY, E2E_TEST} from '$env/static/private';
import { sendEventCreatedEmail } from "./server/email";
import { geocodeAddressCached } from "./server/google";

const r2Creds = assets.loadCreds({
    S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY,
    S3_BUCKET_NAME,
    CLOUDFLARE_ACCOUNT_ID
});

// using `command` instead of `query` cuz query does not allow setting cookies
export const fetchEventsWithCookiePersistence = command(loadEventsParamsSchema, async (params) => {
    const { cookies } = getRequestEvent();

    if (!cookies) {
        // Fallback to regular fetchEvents if no cookies context
        return prepareEventsResultForUi(await fetchEvents(params));
    }

    // Load saved filters from cookie
    const savedFilters = loadFiltersFromCookie(cookies);

    // Check if the current params are different from saved filters
    const hasChanged = savedFilters ? (
        params.startDate !== savedFilters.startDate ||
        params.endDate !== savedFilters.endDate ||
        params.plzCity !== savedFilters.plzCity ||
        params.distance !== savedFilters.distance ||
        params.lat !== savedFilters.lat ||
        params.lng !== savedFilters.lng ||
        params.searchTerm !== savedFilters.searchTerm ||
        params.sortBy !== savedFilters.sortBy ||
        params.sortOrder !== savedFilters.sortOrder ||
        JSON.stringify(params.tagIds) !== JSON.stringify(savedFilters.tagIds) ||
        params.attendanceMode !== savedFilters.attendanceMode
    ) : true;

    // Fetch events with current params
    const result = prepareEventsResultForUi(await fetchEvents(params));

    posthogCapture('events_fetched', {
        events: result.events.length,
        totalEvents: result.pagination.totalEvents,
        totalPages: result.pagination.totalPages,
        lat: result.pagination.lat,
        lng: result.pagination.lng,
        plzCity: result.pagination.plzCity,
        distance: result.pagination.distance,
        searchTerm: result.pagination.searchTerm,
        sortBy: result.pagination.sortBy,
        sortOrder: result.pagination.sortOrder,
        tagIds: result.pagination.tagIds,
        attendanceMode: result.pagination.attendanceMode
    })

    // Save to cookie only if params have changed (and not on pagination)
    if (hasChanged && params.page === 1) {
        const filterData = {
            startDate: params.startDate,
            endDate: params.endDate,
            plzCity: params.plzCity,
            distance: params.distance,
            lat: params.lat,
            lng: params.lng,
            searchTerm: params.searchTerm,
            sortBy: params.sortBy,
            sortOrder: params.sortOrder,
            tagIds: params.tagIds,
            attendanceMode: params.attendanceMode
        };

        saveFiltersToCookie(cookies, filterData);
    }

    nothing().refresh()

    return result;
});

export const nothing = query(async () => {
    // no-op to be used with `command.updates(nothing)` to force svelte to not reload queries
    // can be removed when this is implemented: https://github.com/sveltejs/kit/issues/14079
})

export const updateEvent = form(updateEventSchema, async (data, issue) => {
    const eventFromDb = await assertUserIsAllowedToEditEvent(data.eventId, data.hostSecret);

    const formData = formDataToDbData(data);
    const [coords, uploadedImageUrls] = await Promise.all([
        geocodeAddressCached(formData.address, GOOGLE_MAPS_API_KEY),
        uploadImages({ files: data.images, slug: eventFromDb.slug })
    ]);
    if (formData.address.length && !coords) return invalid(issue.address(`Address was not found`));
    
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
            slug: undefined, // never change slug
        }).where(eq(s.events.id, eventFromDb.id));

        await tx.delete(s.eventTags).where(eq(s.eventTags.eventId, eventFromDb.id));
        if (data.tagIds?.length) {
            await tx.insert(s.eventTags).values(data.tagIds.map((tagId: number) => ({ eventId: eventFromDb.id, tagId })));
        }
    });

    if (deletedImageUrls?.length && E2E_TEST !== `true`) {
        await assets.deleteImages(deletedImageUrls, r2Creds);
    }

    redirect(303, routes.eventDetails(eventFromDb.slug));
});

export const createEvent = form(createEventSchema, async (data, issue) => {
    const { locals } = getRequestEvent();
    const userId = locals.userId;
    const userEmail = locals.jwtClaims?.email;
    if (!userId) throw error(401, 'You must be signed in to create an event');
    if (!userEmail) throw error(400, 'Signed-in user does not have an email');

    console.log({ data })
    const event = formDataToDbData(data);
    const [coords, imageUrls] = await Promise.all([
        geocodeAddressCached(event.address, GOOGLE_MAPS_API_KEY), 
        uploadImages({ files: data.images, slug: event.slug })
    ]);
    if (event.address.length && !coords) return invalid(issue.address(`Address was not found`));

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

        console.log({ createdEvent })
        if (!createdEvent) throw error(500, "Failed to create event");

        if (data.tagIds.length > 0) {
            await tx.insert(s.eventTags).values(data.tagIds.map(tagId => ({
                eventId: createdEvent!.id,
                tagId,
            })));
        }
    })

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

function formDataToDbData(data: CreateEventData) {
    const timeZone = data.timeZone ?? "Europe/Berlin";
    const startAt = utcDate(data.startAt, timeZone)
    const endAt = data.endAt ? utcDate(data.endAt, timeZone) : undefined;
    const address = data.address?.split(/,|\n/).map(x => x.trim()).filter(x => x) ?? [];
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
 * Processes uploaded event images and reuses uploads cached during this server run.
 *
 * @example
 * await uploadImages({ files: [], slug: `demo-event` }) // []
 */
async function uploadImages(args: uploadImagesArgs) {
    if (!args.files?.length) return [];
    if (E2E_TEST === `true`) {
        return getE2EImageUrls(args);
    }
    console.time("uploadImages");

    const processedCreateEventImages = new Map<string, Promise<string>>();

    const imageUrls: string[] = [];
    for (const file of args.files) {
        if (!file || file.size <= 0) continue;

        let cacheKey: string | undefined = undefined;
        try {
            const bytes = Buffer.from(await file.arrayBuffer());
            const { buffer, phash } = await resizeCoverImage(bytes);
            cacheKey = `${args.slug}:${phash}`;
            let imageUrlPromise = processedCreateEventImages.get(cacheKey);

            if (!imageUrlPromise) {
                imageUrlPromise = (async () => {
                    return await assets.uploadImage(buffer, args.slug, phash, r2Creds);
                })();
                processedCreateEventImages.set(cacheKey, imageUrlPromise);
            }

            imageUrls.push(await imageUrlPromise);
        } catch (err) {
            if (cacheKey) processedCreateEventImages.delete(cacheKey);
            const message = err instanceof Error ? err.message : String(err);
            console.error(`Error processing event image "${file.name}". Skipping it:`, message);
        }
    }

    console.timeEnd("uploadImages");
    return imageUrls;
}

/**
 * Builds deterministic mock image URLs for E2E without touching external storage.
 *
 * @example
 * getE2EImageUrls({ files: [], slug: `demo-event` }) // []
 */
function getE2EImageUrls(args: uploadImagesArgs) {
    if (!args.files?.length) return [];

    return args.files.map((file, index) => {
        const safeFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, `-`);
        return `https://assets.blissbase.app/e2e/${args.slug}/${index}-${safeFileName}.webp`;
    });
}

/**
 * Resolves the final image order for an event update and which old images should be deleted.
 *
 * @example
 * getImagesForEventUpdate({
 *   existingImageUrls: [`https://img/old.webp`],
 *   imageTokens: [`new:file-1`, `https://img/old.webp`],
 *   uploadedImageUrls: [`https://img/new.webp`]
 * });
 */
function getImagesForEventUpdate(args: getImagesForEventUpdateArgs) {
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

const deleteEventSchema = v.object({
    eventId: v.number(),
    hostSecret: v.string(),
});

export const deleteEvent = command(deleteEventSchema, async ({ eventId, hostSecret }) => {
    await assertUserIsAllowedToEditEvent(eventId, hostSecret);

    try {
        const result = await db
            .delete(s.events)
            .where(eq(s.events.id, eventId))
            .returning({ id: s.events.id, name: s.events.name, imageUrls: s.events.imageUrls });

        if (result[0].imageUrls && result[0].imageUrls.length > 0) {
            await assets.deleteImages(result[0].imageUrls, r2Creds);
        }

        return {
            success: true,
            deletedEvent: result[0],
            message: `Event ${result[0].id} has been deleted successfully`
        };
    } catch (err) {
        console.error('Failed to delete event:', err);
        if (err instanceof Error && 'status' in err) {
            throw err; // Re-throw SvelteKit errors
        }
        return error(500, 'Failed to delete event');
    }
});

export const estimateEventCount = prerender(async () => {
    return await db.$count(s.events, eq(s.events.listed, true));
});

function utcDate(localDateTime: string, timeZone: string): Date {
    const utcDateTime = applyTimezone(localDateTime, timeZone);
    return new Date(utcDateTime);
}

/**
 * Interprets a naive ISO datetime string (e.g. `2026-03-12T19:00`) as being in
 * the given IANA timezone and returns a UTC ISO string.
 *
 * @example
 * applyTimezone(`2026-03-12T19:00`, `Europe/Berlin`) // `2026-03-12T18:00:00.000Z`
 */
function applyTimezone(naiveDatetime: string, timeZone: string): string {
    // Parse the naive datetime as if it were UTC to get a reference point
    const naive = new Date(`${naiveDatetime}Z`);

    // Get the UTC offset for this timezone at this approximate local time
    // by comparing what the formatter reports vs UTC
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

    // Format the naive-as-UTC date in the target timezone to find the offset
    const parts = formatter.formatToParts(naive);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? `0`;
    const tzYear = parseInt(get(`year`));
    const tzMonth = parseInt(get(`month`)) - 1;
    const tzDay = parseInt(get(`day`));
    const tzHour = parseInt(get(`hour`)) % 24;
    const tzMinute = parseInt(get(`minute`));
    const tzSecond = parseInt(get(`second`));

    // Reconstruct what UTC time corresponds to the naive local time
    const tzAsUtc = Date.UTC(tzYear, tzMonth, tzDay, tzHour, tzMinute, tzSecond);
    const offsetMs = naive.getTime() - tzAsUtc;
    const localMs = naive.getTime() + offsetMs;

    return new Date(localMs).toISOString();
}

async function assertUserIsAllowedToEditEvent(eventId: number, hostSecret: string) {
    const { locals: { userId } } = getRequestEvent();
    const event = await db.query.events.findFirst({ where: eq(s.events.id, eventId) });
    if (!event) return error(404, "Event not found");

    if (await isAdminSession()) return event
    if (userId === event.authorId) return event
    if (hostSecret === event.hostSecret)return event

    return error(403, "You are not allowed to edit this event");
}

type uploadImagesArgs = {
    files: File[];
    slug: string;
};

type getImagesForEventUpdateArgs = {
    existingImageUrls: string[];
    imageTokens: string[];
    uploadedImageUrls: string[];
};