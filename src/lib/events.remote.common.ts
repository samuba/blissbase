import * as v from 'valibot';

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
	name: v.pipe(v.string(), v.trim(), v.nonEmpty(`Event Name muss ausgefüllt werden`)),
	description: v.pipe(
		v.string(),
		v.trim(),
		v.nonEmpty(`Beschreibung muss ausgefüllt werden`),
		v.maxLength(100_000, `Beschreibung ist zu lang`)
	),
	tagIds: v.optional(v.pipe(v.array(v.string()), v.transform((x) => x.map((y) => parseInt(y)))), []),
	price: v.optional(emptyStringIsUndefined(v.pipe(v.string(), v.trim()))),
	address: v.optional(emptyStringIsUndefined(v.pipe(v.string(), v.trim()))),
	startAt: v.pipe(v.string(), v.isoDateTime(`Startdatum ist ungültig.`)),
	endAt: v.optional(emptyStringIsUndefined(v.pipe(v.string(), v.isoDateTime(`Enddatum ist ungültig.`)))),
	timeZone: v.optional(emptyStringIsUndefined(v.pipe(v.string()))),
	isOnline: v.optional(v.boolean(), false),
	isNotListed: v.optional(v.boolean(), false),
	contact: v.optional(v.string()),
	contactMethod: v.optional(v.string()),
	images: v.optional(v.array(v.pipe(v.file(), v.maxSize(30 * 1024 * 1024, `Bilder dürfen maximal 30MB groß sein`))), [])
} satisfies v.ObjectEntries;

export const createEventSchema = v.pipe(
	v.object(eventSchemaEntries),
	v.forward(
		v.partialCheck(
			[['startAt']],
			(input) => new Date(input.startAt).getTime() > Date.now(),
			`Startdatum muss in der Zukunft liegen`
		),
		['startAt']
	),
	v.forward(
		v.partialCheck(
			[['startAt'], ['endAt']],
			(input) => {
				if (!input.endAt) return true;
				return new Date(input.endAt).getTime() > new Date(input.startAt).getTime();
			},
			`Enddatum muss nach dem Startdatum liegen`
		),
		['endAt']
	),
	v.forward(
		v.partialCheck(
			[['isOnline'], ['address']],
			(input) => {
				if (input.isOnline) return true;
				return !!input.address;
			},
			`Adresse muss ausgefüllt werden`
		),
		['address']
	),
	v.forward(
		v.partialCheck(
			[['contactMethod'], ['contact']],
			({ contactMethod, contact }) => {
				if (contactMethod === `email`) return !!contact?.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
				if (contactMethod === `phone`) return !!contact?.match(/^\+?\d[\d\s\-()]+\d$/);
				if (contactMethod === `website`) return !!contact?.match(/^https?:\/\/[^\s]+$/);
				if (contactMethod === `whatsapp`) return !!contact?.match(/^\+?\d[\d\s\-()]+\d$/);
				if (contactMethod === `telegram`) return !!contact?.match(/^@[^\s]+$/);
				return true;
			},
			`Kontakt-Methode ist ungültig`
		),
		['contact']
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
		v.partialCheck(
			[['startAt'], ['endAt']],
			(input) => {
				if (!input.endAt) return true;
				return new Date(input.endAt).getTime() > new Date(input.startAt).getTime();
			},
			`Enddatum muss nach dem Startdatum liegen`
		),
		['endAt']
	),
	v.forward(
		v.partialCheck(
			[['isOnline'], ['address']],
			(input) => {
				if (input.isOnline) return true;
				return !!input.address;
			},
			`Adresse muss ausgefüllt werden`
		),
		['address']
	),
	v.forward(
		v.partialCheck(
			[['contactMethod'], ['contact']],
			({ contactMethod, contact }) => {
				if (contactMethod === `email`) return !!contact?.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
				if (contactMethod === `phone`) return !!contact?.match(/^\+?\d[\d\s\-()]+\d$/);
				if (contactMethod === `website`) return !!contact?.match(/^https?:\/\/[^\s]+$/);
				if (contactMethod === `whatsapp`) return !!contact?.match(/^\+?\d[\d\s\-()]+\d$/);
				if (contactMethod === `telegram`) return !!contact?.match(/^@[^\s]+$/);
				return true;
			},
			`Kontakt-Methode ist ungültig`
		),
		['contact']
	)
);

/**
 * Converts persisted event data into the shared edit form values (including `storedContactUriToFormFields` for `contact`).
 *
 * @example
 * getEditEventInitialValues({ event: { id: 1, name: `Foo`, startAt: new Date(), endAt: null, address: [], description: `x`, price: null, listed: true, attendanceMode: `offline`, contact: [], imageUrls: [] }, tagIds: [] });
 */
export function getEditEventInitialValues(args: { event: EditEventSource; tagIds: number[] }) {
	const firstContact = args.event.contact?.[0] ?? ``;
	const { contactMethod, contact } = storedContactUriToFormFields({ storedContactUri: firstContact });

	return {
		eventId: args.event.id,
		hostSecret: args.event.hostSecret ?? ``,
		name: args.event.name,
		description: args.event.description ?? ``,
		tagIds: args.tagIds.map((x) => x.toString()),
		price: args.event.price ?? ``,
		address: (args.event.address ?? []).join(`\n`),
		startAt: formatDateForLocalInput(args.event.startAt),
		endAt: args.event.endAt ? formatDateForLocalInput(args.event.endAt) : ``,
		isOnline: args.event.attendanceMode === `online`,
		isNotListed: !args.event.listed,
		contact,
		contactMethod,
		existingImageUrls: args.event.imageUrls ?? [],
		images: []
	};
}

/**
 * Formats a Date into a value accepted by `datetime-local` inputs.
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

type EditEventSource = {
	id: number;
	hostSecret: string | null;
	name: string;
	description: string | null;
	address: string[] | null;
	startAt: Date;
	endAt: Date | null;
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