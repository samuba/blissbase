import { publicProfilePatchSchema } from '$lib/rpc/profile.common';
import * as v from 'valibot';

export const OFFERING_FORMATS = ['offline', 'online', 'offline+online'] as const;
export const OFFERING_IMAGE_MAX_COUNT = 12;

export const offeringProfileFormSchema = publicProfilePatchSchema;

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

/**
 * Stable per-day offering order: same-day creations stay on top (newest first),
 * everything else is a deterministic shuffle for that Berlin calendar day.
 */
export function sortOfferingsForDailyList<T extends { id: number; createdAt: Date }>(
	offerings: T[],
	now = new Date(),
) {
	if (!offerings?.length) return [];

	const todayKey = berlinDayKey(now);
	return [...offerings].sort((a, b) => {
		const aIsNew = berlinDayKey(a.createdAt) === todayKey;
		const bIsNew = berlinDayKey(b.createdAt) === todayKey;
		if (aIsNew !== bIsNew) return aIsNew ? -1 : 1;

		if (aIsNew) {
			const createdDiff = b.createdAt.getTime() - a.createdAt.getTime();
			if (createdDiff !== 0) return createdDiff;
			return b.id - a.id;
		}

		const rankDiff = dailyShuffleRank({ id: a.id, day: todayKey }) - dailyShuffleRank({ id: b.id, day: todayKey });
		if (rankDiff !== 0) return rankDiff;
		return a.id - b.id;
	});
}

function berlinDayKey(date: Date) {
	return date.toLocaleDateString(`en-CA`, { timeZone: `Europe/Berlin` });
}

function dailyShuffleRank({ id, day }: { id: number; day: string }) {
	let hash = 2166136261;
	const input = `${day}:${id}`;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}
