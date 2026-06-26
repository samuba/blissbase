import { publicProfileFormSchema } from '$lib/rpc/profile.common';
import * as v from 'valibot';

export const OFFERING_FORMATS = ['offline', 'online', 'offline+online'] as const;
export const OFFERING_IMAGE_MAX_COUNT = 12;

const offeringFormEntries = {
	title: v.pipe(
		v.string(),
		v.trim(),
		v.nonEmpty(`Titel muss ausgefüllt werden`),
		v.maxLength(160, `Titel ist zu lang`)
	),
	descriptionHtml: v.pipe(v.string(), v.trim(), v.maxLength(50_000, `Beschreibung ist zu lang`)),
	format: v.picklist(OFFERING_FORMATS, `Angebotsformat ist ungültig`),
	profile: v.optional(publicProfileFormSchema),
	imageClaims: v.optional(
		v.pipe(
			v.array(v.pipe(v.string(), v.trim(), v.nonEmpty())),
			v.maxLength(OFFERING_IMAGE_MAX_COUNT, `Du kannst maximal ${OFFERING_IMAGE_MAX_COUNT} Bilder hochladen`)
		),
		[]
	),
	email: v.optional(v.pipe(v.string(), v.trim(), v.email(`E-Mail ist ungültig`))),
	authToken: v.optional(v.pipe(v.string(), v.trim()), ``),
	returnTo: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(2_000)), ``)
} satisfies v.ObjectEntries;

export const offeringFormSchema = v.object(offeringFormEntries);

export const updateOfferingFormSchema = v.object({
	...offeringFormEntries,
	offeringId: v.pipe(v.number(), v.integer(), v.minValue(1)),
	existingImageUrls: v.optional(v.array(v.pipe(v.string(), v.trim(), v.url(`Bild-URL ist ungültig`))), []),
	imageOrder: v.optional(v.array(v.pipe(v.string(), v.trim(), v.nonEmpty())), [])
});

export type OfferingForm = v.InferOutput<typeof offeringFormSchema>;
export type UpdateOfferingForm = v.InferOutput<typeof updateOfferingFormSchema>;
export type OfferingFormat = (typeof OFFERING_FORMATS)[number];
