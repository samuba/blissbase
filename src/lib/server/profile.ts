import { slugify, stripHtml, trimAllWhitespaces, type Modify } from '$lib/common';
import type { OfferingFormat, OfferingPlaceFilter } from '$lib/rpc/offerings.common';
import { type PublicProfileSocialLinks } from '$lib/rpc/profile.common';
import { db, s, and, asc, desc, eq, gte, sql } from '$lib/server/db';
import { eventWith, prepareEventsForUi, type UiEvent } from '$lib/server/events';
import type { Profile } from '$lib/server/schema';
import { type ProfileSocialType } from '$lib/socialLinks';

/**
 * Builds the editable/public slug for a profile.
 *
 * @example
 * createPublicProfileSlug({ displayName: `Anna Müller` });
 */
export function createPublicProfileSlug(args: { displayName: string }) {
	const slug = slugify(args.displayName).replace(/^-+|-+$/g, ``).slice(0, 80);
	return slug;
}

export async function getPublicProfileBySlug(args: { slug: string }) {
	return await db.query.profiles.findFirst({
		where: eq(s.profiles.slug, args.slug),
		columns: {
			// state columns specifically to not leak sensitive data
			id: true,
			slug: true,
			displayName: true,
			bio: true,
			profileImageUrl: true,
			bannerImageUrl: true,
			socialLinks: true,
		},
		with: {
			place: {
				columns: {
					name: true,
					slug: true
				}
			}
		}
	});
}

/**
 * Loads public upcoming events for one profile owner.
 *
 * @example
 * await getUpcomingEventsForPublicProfile({ authorId: `user-1` });
 */
export async function getUpcomingEventsForPublicProfile(args: { authorId: string }) {
	const endsAtOrDefault = sql<Date>`COALESCE(${s.events.endAt}, ${s.events.startAt} + interval '4 hours')`;
	const events = await db.query.events.findMany({
		where: and(
			eq(s.events.authorId, args.authorId),
			eq(s.events.listed, true),
			gte(endsAtOrDefault, sql`NOW()`)
		),
		with: eventWith,
		orderBy: [asc(s.events.startAt), asc(s.events.id)]
	});

	return prepareEventsForUi(events) as UiEvent[];
}

/**
 * Loads listed offerings owned by a public profile for display on that profile page.
 *
 * @example
 * await getOfferingsForPublicProfile({ profile });
 */
export async function getOfferingsForPublicProfile(args: {
	profile: Pick<
		Profile,
		'id' | 'slug' | 'displayName' | 'bio' | 'profileImageUrl' | 'bannerImageUrl' | 'socialLinks'
	> & {
		place: { name: string; slug: string } | null;
	};
}) {
	const offerings = await db.query.offerings.findMany({
		where: and(eq(s.offerings.profileId, args.profile.id), eq(s.offerings.listed, true)),
		columns: {
			id: true,
			title: true,
			descriptionHtml: true,
			format: true
		},
		orderBy: [desc(s.offerings.createdAt)]
	});

	return offerings.map((offering) => ({
		id: offering.id,
		title: offering.title,
		descriptionHtml: offering.descriptionHtml ?? ``,
		format: offering.format,
		offeringPlaceFilter: getOfferingPlaceFilter(offering.format),
		profile: {
			slug: args.profile.slug,
			displayName: args.profile.displayName,
			bio: args.profile.bio ?? ``,
			profileImageUrl: args.profile.profileImageUrl ?? ``,
			bannerImageUrl: args.profile.bannerImageUrl ?? ``,
			socialLinks: args.profile.socialLinks,
			place: args.profile.place
				? {
						name: args.profile.place.name,
						slug: args.profile.place.slug
					}
				: null
		}
	}));
}

function getOfferingPlaceFilter(format: OfferingFormat): OfferingPlaceFilter {
	if (format === `online` || format === `offline+online`) return `online`;
	return `danang-hoi-an`;
}

/**
 * Builds a short plain-text bio preview for cards.
 *
 * @example
 * getPublicProfileBioExcerpt({ bio: `<p>Hello world</p>` });
 */
export function getPublicProfileBioExcerpt(args: { bio?: string | null }) {
	const plainText = trimAllWhitespaces(stripHtml(args.bio ?? ``)) ?? ``;
	if (plainText.length <= 110) return plainText;
	return `${plainText.slice(0, 107).trim()}...`;
}

/**
 * A profile is public once it has the minimum fields for a stable public page.
 *
 * @example
 * isPublicProfile({ slug: `anna`, displayName: `Anna` } as Profile);
 */
export function isPublicProfile(
	profile: Pick<Profile, 'slug' | 'displayName'> | null | undefined
): profile is Pick<Profile, 'slug' | 'displayName'> & { slug: string; displayName: string } {
	return Boolean(profile?.slug?.trim() && profile?.displayName?.trim());
}

/**
 * Normalizes one social/contact value for storage (schemes, mailto, Telegram, WhatsApp).
 *
 * @example
 * normalizePublicProfileValue({ type: `telegram`, value: `@blissbase` });
 */
function normalizePublicProfileValue(args: { type: ProfileSocialType; value: string }) {
	const value = args.value.trim();
	if (!value) return null;

	if (args.type === `email`) {
		return value.startsWith(`mailto:`) ? value : `mailto:${value}`;
	}

	if (args.type === `telegram`) {
		if (value.startsWith(`tg://`) || value.startsWith(`https://`) || value.startsWith(`http://`)) {
			return value;
		}
		return `https://t.me/${value.replace(/^@/, ``)}`;
	}

	if (args.type === `whatsapp`) {
		if (value.startsWith(`https://`) || value.startsWith(`http://`)) {
			return value;
		}
		const digits = value.replace(/\D/g, ``);
		if (!digits) return null;
		return `https://wa.me/${digits}`;
	}

	if (value.startsWith(`https://`) || value.startsWith(`http://`)) {
		return value;
	}

	return `https://${value}`;
}

export type PreparedPublicProfile = Modify<
	Profile,
	{
		displayName: string;
		socialLinks: PublicProfileSocialLinks;
		bioExcerpt: string;
	}
>;
