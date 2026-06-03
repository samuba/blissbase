import { publicProfileFormSchema } from '$lib/rpc/profile.common';
import * as v from 'valibot';

export const OFFERING_FORMATS = ['offline', 'online', 'offline+online'] as const;
export const OFFERING_PLACE_FILTERS = ['online', 'danang', 'hoi-an', 'danang-hoi-an'] as const;

export const offeringFormSchema = v.object({
	title: v.pipe(
		v.string(),
		v.trim(),
		v.nonEmpty(`Titel muss ausgefüllt werden`),
		v.maxLength(160, `Titel ist zu lang`)
	),
	descriptionHtml: v.pipe(v.string(), v.trim(), v.maxLength(50_000, `Beschreibung ist zu lang`)),
	format: v.picklist(OFFERING_FORMATS, `Angebotsformat ist ungültig`),
	profile: v.optional(publicProfileFormSchema),
	email: v.optional(v.pipe(v.string(), v.trim(), v.email(`E-Mail ist ungültig`)))
});

export type OfferingForm = v.InferOutput<typeof offeringFormSchema>;
export type OfferingFormat = (typeof OFFERING_FORMATS)[number];
export type OfferingPlaceFilter = (typeof OFFERING_PLACE_FILTERS)[number];
