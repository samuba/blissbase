import {
	isValidProfileLocation,
	profileLocationCheckMessage,
	profileLocationFields,
	publicProfileFields,
} from '$lib/rpc/profile.common';
import * as v from 'valibot';

export const OFFERING_FORMATS = ['offline', 'online', 'offline+online'] as const;
export const OFFERING_IMAGE_MAX_COUNT = 12;

export const offeringProfileFormSchema = v.pipe(
	v.partial(
		v.object({
			displayName: publicProfileFields.displayName,
			bio: publicProfileFields.bio,
			profileImageUrl: publicProfileFields.profileImageUrl,
			bannerImageUrl: publicProfileFields.bannerImageUrl,
			socialLinks: publicProfileFields.socialLinks,
			...profileLocationFields,
		}),
	),
	v.check((data) => isValidProfileLocation(data), profileLocationCheckMessage),
);

const offeringFormEntries = {
	title: v.pipe(
		v.string(),
		v.trim(),
		v.nonEmpty(`Title is required`),
		v.maxLength(160, `Title is too long`)
	),
	descriptionHtml: v.pipe(v.string(), v.trim(), v.maxLength(50_000, `Description is too long`)),
	format: v.picklist(OFFERING_FORMATS, `Offering format is invalid`),
	profile: v.optional(offeringProfileFormSchema),
	imageClaims: v.optional(
		v.pipe(
			v.array(v.pipe(v.string(), v.trim(), v.nonEmpty())),
			v.maxLength(OFFERING_IMAGE_MAX_COUNT, `You can upload a maximum of ${OFFERING_IMAGE_MAX_COUNT} images`)
		),
		[]
	),
	email: v.optional(v.pipe(v.string(), v.trim(), v.email(`Email is invalid`))),
	authToken: v.optional(v.pipe(v.string(), v.trim()), ``),
	returnTo: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(2_000)), ``)
} satisfies v.ObjectEntries;

export const offeringFormSchema = v.object(offeringFormEntries);

export const updateOfferingFormSchema = v.object({
	...offeringFormEntries,
	offeringId: v.pipe(v.number(), v.integer(), v.minValue(1)),
	existingImageUrls: v.optional(v.array(v.pipe(v.string(), v.trim(), v.url(`Image URL is invalid`))), []),
	imageOrder: v.optional(v.array(v.pipe(v.string(), v.trim(), v.nonEmpty())), [])
});

export type OfferingForm = v.InferOutput<typeof offeringFormSchema>;
export type UpdateOfferingForm = v.InferOutput<typeof updateOfferingFormSchema>;
export type OfferingFormat = (typeof OFFERING_FORMATS)[number];

export function offeringNeedsLocation(format: OfferingFormat) {
	return format === `offline` || format === `offline+online`;
}
