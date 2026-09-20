import { command } from "$app/server";
import {
	createGalleryImageUpload,
	discardGalleryImageUpload,
} from "$lib/server/galleryImageClaims";
import { GALLERY_IMAGE_CONTENT_TYPES, GALLERY_IMAGE_KINDS } from "$lib/galleryImages";
import { IMAGE_UPLOAD_HASH_LENGTH } from "$lib/imageUpload.shared";
import * as v from "valibot";

const galleryImageUploadSchema = v.object({
	kind: v.picklist(GALLERY_IMAGE_KINDS),
	contentType: v.picklist(GALLERY_IMAGE_CONTENT_TYPES),
	hash: v.pipe(v.string(), v.regex(new RegExp(`^[A-Za-z0-9_-]{${IMAGE_UPLOAD_HASH_LENGTH}}$`))),
});

export const createGalleryImageUploadUrl = command(galleryImageUploadSchema, async ({ kind, contentType, hash }) => {
	return createGalleryImageUpload({ kind, contentType, hash });
});

export const discardGalleryImage = command(
	v.object({
		claimToken: v.pipe(v.string(), v.trim(), v.nonEmpty()),
	}),
	async ({ claimToken }) => {
		await discardGalleryImageUpload(claimToken);
	},
);
