import { error } from "@sveltejs/kit";
import { db, eq, s } from "$lib/server/db";

export async function load({ locals, params: { id } }) {
	const offeringId = Number(id);
	if (!id || !Number.isInteger(offeringId) || offeringId < 1) {
		error(400, `Invalid offering ID`);
	}

	const offering = await db.query.offerings.findFirst({
		where: eq(s.offerings.id, offeringId),
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
