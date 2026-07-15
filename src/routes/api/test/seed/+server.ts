import { json } from "@sveltejs/kit";
import { db, eq, s } from "$lib/server/db";
import { inArray, sql } from "drizzle-orm";
import type { RequestHandler } from "./$types";
import { E2E_TEST } from "$env/static/private";
import { dev } from "$app/environment";
import { deduplicateItems } from "$lib/common";
import type { PublicProfileSocialLinks } from "$lib/rpc/profile.common";

export const POST: RequestHandler = async ({ request }) => {
	if (E2E_TEST !== "true" || !dev) {
		return json({ error: "Only available in E2E mode" }, { status: 403 });
	}

	const { action, data } = await request.json();

	try {
		switch (action) {
			case "createEvent": {
				const [event] = await db
					.insert(s.events)
					.values({
						name: data.name || "Test Event",
						description: data.description || "Test description",
						startAt: data.startAt ? new Date(data.startAt) : new Date(Date.now() + 24 * 60 * 60 * 1000),
						endAt: data.endAt ? new Date(data.endAt) : null,
						address: data.address || ["Test Address"],
						price: data.price || "Free",
						priceIsHtml: false,
						imageUrls: deduplicateItems(data.imageUrls),
						host: data.host || "Test Host",
						hostLink: data.hostLink || null,
						contact: data.contact || [],
						latitude: data.latitude || null,
						longitude: data.longitude || null,
						tags: data.tags || ["Meditation"],
						source: data.source || "tribehaus",
						sourceUrl: data.sourceUrl || "https://example.com",
						slug: data.slug || `e2e-${Date.now()}`,
						listed: true,
						soldOut: false,
						hostSecret: data.hostSecret || "test-secret",
						attendanceMode: data.attendanceMode || "offline",
						createdAt: new Date(),
						updatedAt: new Date(),
					})
					.returning();
				return json({ success: true, event });
			}

			case "clearEvents": {
				const slugPrefix = data?.slugPrefix;
				if (slugPrefix) {
					await db.delete(s.events).where(sql`${s.events.slug} LIKE ${slugPrefix + "%"}`);
				} else {
					await db.delete(s.events);
				}
				return json({ success: true });
			}

			case "clearAllEvents":
				await db.delete(s.events);
				return json({ success: true });

			case "getEventById": {
				const event = await db.query.events.findFirst({
					where: eq(s.events.id, data.id),
				});
				return json({ success: true, event });
			}

			case "createProfile": {
				const [profile] = await db
					.insert(s.profiles)
					.values({
						id: data.id,
						slug: data.slug ?? null,
						displayName: data.displayName ?? null,
						bio: data.bio ?? null,
						locale: data.locale ?? `en`,
						profileImageUrl: data.profileImageUrl ?? null,
						bannerImageUrl: data.bannerImageUrl ?? null,
						socialLinks: (data.socialLinks ?? []) as PublicProfileSocialLinks,
						locationLabel: data.locationLabel ?? null,
						latitude: data.latitude ?? null,
						longitude: data.longitude ?? null,
					})
					.onConflictDoUpdate({
						target: s.profiles.id,
						set: {
							slug: data.slug ?? null,
							displayName: data.displayName ?? null,
							bio: data.bio ?? null,
							profileImageUrl: data.profileImageUrl ?? null,
							bannerImageUrl: data.bannerImageUrl ?? null,
							socialLinks: (data.socialLinks ?? []) as PublicProfileSocialLinks,
							locationLabel: data.locationLabel ?? null,
							latitude: data.latitude ?? null,
							longitude: data.longitude ?? null,
							updatedAt: new Date(),
						},
					})
					.returning();
				return json({ success: true, profile });
			}

			case "getProfileById": {
				const profile = await db.query.profiles.findFirst({
					where: eq(s.profiles.id, data.id),
				});
				return json({ success: true, profile });
			}

			case "createOffering": {
				const [offering] = await db
					.insert(s.offerings)
					.values({
						profileId: data.profileId,
						slug: data.slug,
						title: data.title ?? `Test Offering`,
						descriptionHtml: data.descriptionHtml ?? null,
						format: data.format ?? `offline`,
						imageUrls: deduplicateItems(data.imageUrls),
						listed: data.listed ?? true,
					})
					.returning();
				return json({ success: true, offering });
			}

			case "clearOfferings": {
				const slugPrefix = data?.slugPrefix;
				if (slugPrefix) {
					await db.delete(s.offerings).where(sql`${s.offerings.slug} LIKE ${`${slugPrefix}%`}`);
				} else {
					await db.delete(s.offerings);
				}
				return json({ success: true });
			}

			case "clearProfiles": {
				const profileIds = data?.profileIds as string[] | undefined;
				if (profileIds?.length) {
					await db.delete(s.profiles).where(inArray(s.profiles.id, profileIds));
				}
				return json({ success: true });
			}

			case "getOfferingById": {
				const offering = await db.query.offerings.findFirst({
					where: eq(s.offerings.id, data.id),
				});
				return json({ success: true, offering });
			}

			case "getOfferingBySlug": {
				const offering = await db.query.offerings.findFirst({
					where: eq(s.offerings.slug, data.slug),
				});
				return json({ success: true, offering });
			}

			default:
				return json({ error: "Unknown action" }, { status: 400 });
		}
	} catch (error) {
		console.error("Seed error:", error);
		return json({ error: String(error) }, { status: 500 });
	}
};
