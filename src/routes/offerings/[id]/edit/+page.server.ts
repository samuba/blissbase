import { db, eq, s } from "$lib/server/db";
import { error } from "@sveltejs/kit";

export async function load({ locals, params: { id: slug } }) {
	if (!slug?.trim()) {
		error(400, `Invalid offering slug`);
	}

	const offering = await db.query.offerings.findFirst({
		where: eq(s.offerings.slug, slug),
	});
	if (!offering) {
		error(404, `Offering not found`);
	}
	if (offering.profileId !== locals.userId) {
		error(403, `You are not allowed to edit this offering`);
	}

	return {
		offering,
		editFormValues: {
			offeringId: offering.id,
			title: offering.title,
			descriptionHtml: offering.descriptionHtml ?? ``,
			format: offering.format,
			existingImageUrls: offering.imageUrls ?? [],
			imageOrder: offering.imageUrls ?? [],
			imageClaims: [],
		},
	};
}
