import * as v from 'valibot';

export const createEventSchema = v.pipe(
	v.object({
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
	}),
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
				if (contactMethod === `Telegram`) return !!contact?.match(/^@[^\s]+$/);
				return true;
			},
			`Kontakt-Methode ist ungültig`
		),
		['contact']
	)
);

const createEventPipeItems = createEventSchema.pipe.filter((_, index) => index != 0);

export const updateEventSchema = v.pipe(v.object({
	...createEventSchema.entries,
	eventId: v.number(),
	hostSecret: v.optional(v.string(), ``),
	existingImageUrls: v.optional(v.array(v.string()), []),
}), ...createEventPipeItems as any[]);

/**
 * Converts persisted event data into the shared edit form values.
 * @example
 * getEditEventInitialValues({ event: { id: 1, name: `Foo`, startAt: new Date(), endAt: null, address: [], description: `x`, price: null, listed: true, attendanceMode: `offline`, contact: [], imageUrls: [] }, tagIds: [] });
 */
export function getEditEventInitialValues(args: { event: EditEventSource; tagIds: number[] }) {
	const firstContact = args.event.contact?.[0] ?? ``;

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
		contact: firstContact,
		contactMethod: inferContactMethod({ contact: firstContact }),
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
 * Guesses a contact method from a contact value.
 * @example
 * inferContactMethod({ contact: `hello@example.com` }); // `email`
 */
export function inferContactMethod(args: { contact: string }) {
	const contact = args.contact.trim();
	if (!contact) return `none`;
	if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return `email`;
	if (/^https?:\/\/[^\s]+$/.test(contact)) return `website`;
	if (/^@[^\s]+$/.test(contact)) return `Telegram`;
	if (/^\+?\d[\d\s\-()]+\d$/.test(contact)) return `phone`;
	return `website`;
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