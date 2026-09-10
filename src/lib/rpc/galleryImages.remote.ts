import { command } from "$app/server";
import {
	createGalleryImageUpload,
	discardGalleryImageUpload,
} from "$lib/server/galleryImageClaims";
import { GALLERY_IMAGE_CONTENT_TYPES, GALLERY_IMAGE_KINDS } from "$lib/galleryImages";
import * as v from "valibot";

const galleryImageUploadSchema = v.object({
	kind: v.picklist(GALLERY_IMAGE_KINDS),
	contentType: v.picklist(GALLERY_IMAGE_CONTENT_TYPES),
});

export const createGalleryImageUploadUrl = command(galleryImageUploadSchema, async ({ kind, contentType }) => {
	return createGalleryImageUpload({ kind, contentType });
});

export const discardGalleryImage = command(
	v.object({
		claimToken: v.pipe(v.string(), v.trim(), v.nonEmpty()),
	}),
	async ({ claimToken }) => {
		await discardGalleryImageUpload(claimToken);
	},
);
