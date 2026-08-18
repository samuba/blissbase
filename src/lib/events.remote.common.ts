import * as v from 'valibot';
import { profileLocationFields, publicProfilePatchSchema } from '$lib/rpc/profile.common';

export type ContactMethod = `none` | `email` | `phone` | `website` | `telegram` | `whatsapp`;

/**
 * Guesses a contact method from a plain form value (no `mailto:` / `tel:` prefixes).
 *
 * @example
 * inferContactMethod({ contact: `hello@example.com` }); // `email`
 * inferContactMethod({ contact: `https://wa.me/491234` }); // `whatsapp`
 */
export function inferContactMethod(args: { contact: string }): ContactMethod {
	const contact = args.contact.trim();
	if (!contact) return `none`;
	if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return `email`;
	if (/^https?:\/\/(www\.)?wa\.me\/[^\s]+$/i.test(contact)) return `whatsapp`;
	if (/^https?:\/\/(www\.)?api\.whatsapp\.com\/[^\s]+$/i.test(contact)) return `whatsapp`;
	if (/^https?:\/\/[^\s]+$/.test(contact)) return `website`;
	if (/^@[^\s]+$/.test(contact)) return `telegram`;
	if (/^\+?\d[\d\s\-()]+\d$/.test(contact)) return `phone`;
	return `website`;
}

/**
 * Maps a persisted contact URI (`events.contact[]`) to form `contact` + `contactMethod`.
 * Used when the server builds edit-form defaults (`getEditEventInitialValues`).
 * The opposite direction (plain form values → DB URIs) is `formDataToDbData` in `eventMutations.remote.ts`.
 *
 * @example
 * storedContactUriToFormFields({ storedContactUri: `tel:+234` })
 * // { contactMethod: `phone`, contact: `+234` }
 */
export function storedContactUriToFormFields(args: { storedContactUri: string }): {
	contactMethod: ContactMethod;
	contact: string;
} {
	const raw = args.storedContactUri.trim();
	if (!raw) {
		return { contactMethod: `none`, contact: `` };
	}
	if (raw.startsWith(`mailto:`)) {
		return { contactMethod: `email`, contact: raw.slice(`mailto:`.length) };
	}
	if (raw.startsWith(`tel:`)) {
		return { contactMethod: `phone`, contact: raw.slice(`tel:`.length) };
	}
	if (raw.startsWith(`tg://`)) {
		const afterProtocol = raw.slice(`tg://`.length);
		const domainMatch = /^resolve\?domain=(.+)$/.exec(afterProtocol);
		if (domainMatch?.[1]) {
			let domain = decodeURIComponent(domainMatch[1]);
			if (!domain.startsWith(`@`)) {
				domain = `@${domain}`;
			}
			return { contactMethod: `telegram`, contact: domain };
		}
		const handle = afterProtocol.startsWith(`@`) ? afterProtocol : `@${afterProtocol}`;
		return { contactMethod: `telegram`, contact: handle };
	}
	if (raw.startsWith(`https://wa.me/`)) {
		return { contactMethod: `whatsapp`, contact: raw.slice(`https://wa.me/`.length) };
	}
	if (raw.startsWith(`https://`) || raw.startsWith(`http://`)) {
		return { contactMethod: `website`, contact: raw };
	}
	const method = inferContactMethod({ contact: raw });
	return { contactMethod: method, contact: raw };
}

const eventSchemaEntries = {
	name: v.pipe(v.string(), v.trim(), v.nonEmpty(`Event name is required`)),
	description: v.pipe(
		v.string(),
		v.trim(),
		v.nonEmpty(`Description is required`),
		v.maxLength(100_000, `Description is too long`)
	),
	tagIds: v.optional(v.pipe(v.array(v.string()), v.transform((x) => x.map((y) => parseInt(y)))), []),
	price: v.optional(emptyStringIsUndefined(v.pipe(v.string(), v.trim()))),
	address: v.optional(emptyStringIsUndefined(v.pipe(v.string(), v.trim()))),
	addressNote: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(500, `Address note is too long`)), ``),
	latitude: profileLocationFields.latitude,
	longitude: profileLocationFields.longitude,
	startAt: v.pipe(v.string(), v.isoDateTime(`Start date is invalid.`)),
	endAt: v.optional(emptyStringIsUndefined(v.pipe(v.string(), v.isoDateTime(`End date is invalid.`)))),
	timeZone: v.optional(emptyStringIsUndefined(v.pipe(v.string()))),
	isOnline: v.optional(v.boolean(), false),
	isNotListed: v.optional(v.boolean(), false),
	contact: v.optional(v.string()),
	contactMethod: v.optional(v.string()),
	images: v.optional(v.array(v.pipe(v.file(), v.maxSize(30 * 1024 * 1024, `Images may be at most 30MB`))), [])
} satisfies v.ObjectEntries;

function isStartAtInTheFuture(input: { startAt: string }) {
	return new Date(input.startAt).getTime() > Date.now();
}

function isEndAtAfterStartAt(input: { startAt: string; endAt?: string }) {
	if (!input.endAt) return true;
	return new Date(input.endAt).getTime() > new Date(input.startAt).getTime();
}

function hasAddressWhenOffline(input: { isOnline?: boolean; address?: string }) {
	if (input.isOnline) return true;
	return !!input.address;
}

function isContactMethodValid(input: { contactMethod?: string; contact?: string }) {
	const { contactMethod, contact } = input;
	if (contactMethod === `email`) return !!contact?.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
	if (contactMethod === `phone`) return !!contact?.match(/^\+?\d[\d\s\-()]+\d$/);
	if (contactMethod === `website`) return !!contact?.match(/^https?:\/\/[^\s]+$/);
	if (contactMethod === `whatsapp`) return !!contact?.match(/^\+?\d[\d\s\-()]+\d$/);
	if (contactMethod === `telegram`) return !!contact?.match(/^@[^\s]+$/);
	return true;
}

export const createEventSchema = v.pipe(
	v.object({
		...eventSchemaEntries,
		email: v.optional(v.pipe(v.string(), v.trim(), v.email(`Email is invalid`))),
		authToken: v.optional(v.pipe(v.string(), v.trim()), ``),
		profile: v.optional(publicProfilePatchSchema),
	}),
	v.forward(
		v.partialCheck([[`startAt`]], (input) => isStartAtInTheFuture(input), `Start date must be in the future`),
		[`startAt`]
	),
	v.forward(
		v.partialCheck([[`startAt`], [`endAt`]], (input) => isEndAtAfterStartAt(input), `End date must be after the start date`),
		[`endAt`]
	),
	v.forward(
		v.partialCheck([[`isOnline`], [`address`]], (input) => hasAddressWhenOffline(input), `Address is required`),
		[`address`]
	),
	v.forward(
		v.partialCheck([[`contactMethod`], [`contact`]], (input) => isContactMethodValid(input), `Contact method is invalid`),
		[`contact`]
	)
);

export const updateEventSchema = v.pipe(
	v.object({
		...eventSchemaEntries,
		eventId: v.number(),
		hostSecret: v.optional(v.string(), ``),
		existingImageUrls: v.optional(v.array(v.string()), []),
	}),
	v.forward(
		v.partialCheck([[`startAt`], [`endAt`]], (input) => isEndAtAfterStartAt(input), `End date must be after the start date`),
		[`endAt`]
	),
	v.forward(
		v.partialCheck([[`isOnline`], [`address`]], (input) => hasAddressWhenOffline(input), `Address is required`),
		[`address`]
	),
	v.forward(
		v.partialCheck([[`contactMethod`], [`contact`]], (input) => isContactMethodValid(input), `Contact method is invalid`),
		[`contact`]
	)
);

/**
 * Converts persisted event data into the shared edit form values (including `storedContactUriToFormFields` for `contact`).
 *
 * @example
 * getEditEventInitialValues({ event: { id: 1, name: `Foo`, startAt: new Date(), endAt: null, address: [], description: `x`, price: null, listed: true, attendanceMode: `offline`, contact: [], imageUrls: [] }, tagIds: [] });
 */
export function getEditEventInitialValues(event: EditEventSource, tagIds: number[]) {
	const firstContact = event.contact?.[0] ?? ``;
	const { contactMethod, contact } = storedContactUriToFormFields({ storedContactUri: firstContact });

	return {
		eventId: event.id,
		hostSecret: event.hostSecret ?? ``,
		name: event.name,
		description: event.description ?? ``,
		tagIds: tagIds.map((x) => x.toString()),
		price: event.price ?? ``,
		address: (event.address ?? []).join(`, `),
		addressNote: event.addressNote ?? ``,
		latitude: event.latitude == null ? `` : String(event.latitude),
		longitude: event.longitude == null ? `` : String(event.longitude),
		startAt: formatDateForLocalInputInTimeZone(event.startAt, event.timezone ?? DEFAULT_EVENT_FORM_TIME_ZONE),
		endAt: event.endAt
			? formatDateForLocalInputInTimeZone(event.endAt, event.timezone ?? DEFAULT_EVENT_FORM_TIME_ZONE)
			: ``,
		isOnline: event.attendanceMode === `online`,
		isNotListed: !event.listed,
		contact,
		contactMethod,
		existingImageUrls: event.imageUrls ?? [],
		images: []
	};
}

/** Matches `formDataToDbData` default when `timeZone` is omitted (eventMutations.remote). */
const DEFAULT_EVENT_FORM_TIME_ZONE = `Europe/Berlin`;

/**
 * Formats an instant as `YYYY-MM-DDTHH:mm` in a fixed IANA timezone (stable on server for SSR).
 *
 * @example
 * formatDateForLocalInputInTimeZone({
 *   date: new Date(`2026-06-15T12:00:00.000Z`),
 *   timeZone: `Europe/Berlin`
 * }); // CEST → `2026-06-15T14:00`
 */
export function formatDateForLocalInputInTimeZone(date: Date, timeZone: string): string {
	console.log({date, timeZone});
	const formatter = new Intl.DateTimeFormat(`en-CA`, {
		timeZone: timeZone,
		year: `numeric`,
		month: `2-digit`,
		day: `2-digit`,
		hour: `2-digit`,
		minute: `2-digit`,
		hour12: false
	});
	const parts = formatter.formatToParts(date);
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? `0`;
	const year = get(`year`);
	const month = get(`month`);
	const day = get(`day`);
	const hour = String(parseInt(get(`hour`), 10) % 24).padStart(2, `0`);
	const minute = get(`minute`);
	return `${year}-${month}-${day}T${hour}:${minute}`;
}

/**
 * Formats a Date into a value accepted by `datetime-local` inputs using the **current** environment local zone (browser or server).
 * Prefer `formatDateForLocalInputInTimeZone` in server load when the user’s zone is unknown.
 *
 * @example
 * formatDateForLocalInput(new Date(`2026-01-01T10:30:00.000Z`));
 */
export function formatDateForLocalInput(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, `0`);
	const day = String(date.getDate()).padStart(2, `0`);
	const hours = String(date.getHours()).padStart(2, `0`);
	const minutes = String(date.getMinutes()).padStart(2, `0`);
	return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Converts empty form strings into `undefined`.
 */
function emptyStringIsUndefined(schema: v.GenericSchema<string, string>) {
	return v.union([
		v.pipe(v.literal(``), v.transform(() => undefined)),
		schema
	]);
}

/**
 * Prefers a full formatted address, prefixed with the place name when it adds information.
 *
 * @example
 * eventPlaceLabel({ displayName: `Yoga Studio`, formattedAddress: `Musterstraße 1, Berlin` })
 * // `Yoga Studio, Musterstraße 1, Berlin`
 */
export function eventPlaceLabel(args: { displayName: string; formattedAddress: string }) {
	const displayName = args.displayName.trim();
	const formattedAddress = args.formattedAddress.trim();
	if (!formattedAddress) return displayName;
	if (!displayName || formattedAddressHasPlaceName({ formattedAddress, displayName })) return formattedAddress;
	return `${displayName}, ${formattedAddress}`;
}

function formattedAddressHasPlaceName(args: { formattedAddress: string; displayName: string }) {
	const name = args.displayName.trim().toLowerCase();
	const formatted = args.formattedAddress.trim().toLowerCase();
	if (formatted === name) return true;
	return formatted.split(`,`).some((part) => part.trim() === name);
}

type EditEventSource = {
	id: number;
	hostSecret: string | null;
	name: string;
	description: string | null;
	address: string[] | null;
	addressNote?: string | null;
	latitude?: number | null;
	longitude?: number | null;
	startAt: Date;
	endAt: Date | null;
	timezone: string | null;
	price: string | null;
	listed: boolean;
	attendanceMode: `online` | `offline` | `offline+online`;
	contact: string[] | null;
	imageUrls: string[] | null;
};

export type CreateEventSchema = typeof createEventSchema;
export type UpdateEventSchema = typeof updateEventSchema;

export type UpdateEventData = v.InferOutput<UpdateEventSchema>;
export type CreateEventData = v.InferOutput<CreateEventSchema>;