import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@bradenmacdonald/s3-lite-client", () => ({
	S3Client: vi.fn(function S3Client() {
		return {
			copyObject: vi.fn(),
			putObject: vi.fn(),
			deleteObject: vi.fn(),
			exists: vi.fn(),
			listObjects: vi.fn(),
			getPartialObject: vi.fn(
				async () =>
					new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46]), {
						status: 206,
						headers: { "Content-Range": `bytes 0-3/458752` },
					}),
			),
		};
	}),
}));

import { S3Client } from "@bradenmacdonald/s3-lite-client";
import {
	eventImageObjectKey,
	eventTempImageObjectKey,
	finalizeOfferingImage,
	finalizeProfileImage,
	getObjectPrefix,
	isTempEventImageObjectKey,
	isTempOfferingImageObjectKey,
	isTempProfileImageObjectKey,
	loadCreds,
	objectKeyFromPublicUrl,
	offeringImageObjectKey,
	offeringTempImageObjectKey,
	profileTempImageObjectKey,
	uploadEventImage,
	uploadProfileBannerImage,
	uploadProfileImage,
} from "$lib/assets";

function getS3ClientMock() {
	return S3Client as unknown as {
		mockClear: () => void;
		mock: {
			results: Array<{
				value?: {
					copyObject: ReturnType<typeof vi.fn>;
					putObject: ReturnType<typeof vi.fn>;
					deleteObject: ReturnType<typeof vi.fn>;
					getPartialObject: ReturnType<typeof vi.fn>;
				};
			}>;
		};
	};
}

function getS3InstanceMock() {
	const instance = getS3ClientMock().mock.results.at(-1)?.value;
	if (!instance) throw new Error(`Expected S3Client to be instantiated`);
	return instance;
}

function getPutObjectMock() {
	return getS3InstanceMock().putObject;
}

describe(`eventImageObjectKey`, () => {
	it(`uses webp by default and jpg for JPEG uploads`, () => {
		expect(eventImageObjectKey(`demo-event`, `abc123def45`)).toBe(`events/demo-event/abc123def45.webp`);
		expect(eventImageObjectKey(`demo-event`, `abc123def45`, `image/jpeg`)).toBe(`events/demo-event/abc123def45.jpg`);
	});
});

describe(`offering image object keys`, () => {
	it(`builds temporary offering image keys`, () => {
		const key = offeringTempImageObjectKey({
			suffix: `abc123`,
			contentType: `image/jpeg`,
		});

		expect(key).toBe(`offerings/temp/abc123.jpg`);
		expect(isTempOfferingImageObjectKey(key)).toBe(true);
	});

	it(`builds final offering image keys`, () => {
		expect(
			offeringImageObjectKey({
				userId: `user-123`,
				suffix: `abc123`,
				contentType: `image/webp`,
			}),
		).toBe(`offerings/user-123/abc123.webp`);
	});

	it(`rejects unsafe temporary key parts`, () => {
		expect(() =>
			offeringTempImageObjectKey({
				suffix: `../abc123`,
				contentType: `image/webp`,
			}),
		).toThrow(`Offering image suffix contains invalid characters`);
		expect(isTempOfferingImageObjectKey(`offerings/user-123/abc123.webp`)).toBe(false);
	});

	it(`builds temporary event image keys`, () => {
		expect(eventTempImageObjectKey({ suffix: `abc123`, contentType: `image/jpeg` })).toBe(`events/temp/abc123.jpg`);
		expect(isTempEventImageObjectKey(`events/temp/abc123.jpg`)).toBe(true);
		expect(isTempEventImageObjectKey(`events/demo/abc123.jpg`)).toBe(false);
	});
});

describe(`profile image object keys`, () => {
	it(`builds temporary profile image keys`, () => {
		const key = profileTempImageObjectKey({
			type: `profile`,
			suffix: `abc123`,
			contentType: `image/jpeg`,
		});

		expect(key).toBe(`profiles/temp/profile-abc123.jpg`);
		expect(isTempProfileImageObjectKey(key)).toBe(true);
		expect(isTempProfileImageObjectKey(`profiles/user-123/profile-abc123.jpg`)).toBe(false);
	});

	it(`strips signed URL fragments from public asset URLs`, () => {
		expect(objectKeyFromPublicUrl(`https://assets.blissbase.app/profiles/temp/profile-b.webp#claim`)).toBe(`profiles/temp/profile-b.webp`);
	});
});

describe(`temporary image finalization`, () => {
	beforeEach(() => {
		getS3ClientMock().mockClear();
	});

	it(`copies temporary offering images server-side before deleting the source`, async () => {
		const url = await finalizeOfferingImage({
			tempObjectKey: `offerings/temp/abc123.webp`,
			finalObjectKey: `offerings/user-123/abc123.webp`,
			creds: loadCreds({
				S3_ACCESS_KEY_ID: `test-access`,
				S3_SECRET_ACCESS_KEY: `test-secret`,
				S3_BUCKET_NAME: `test-bucket`,
				CLOUDFLARE_ACCOUNT_ID: `test-account`,
			}),
		});

		const instance = getS3InstanceMock();
		expect(instance.copyObject).toHaveBeenCalledWith({ sourceKey: `offerings/temp/abc123.webp` }, `offerings/user-123/abc123.webp`);
		expect(instance.deleteObject).toHaveBeenCalledWith(`offerings/temp/abc123.webp`);
		expect(instance.copyObject.mock.invocationCallOrder[0]).toBeLessThan(instance.deleteObject.mock.invocationCallOrder[0]);
		expect(url).toBe(`https://assets.blissbase.app/offerings/user-123/abc123.webp`);
	});

	it(`copies temporary profile images server-side before deleting the source`, async () => {
		const url = await finalizeProfileImage({
			tempObjectKey: `profiles/temp/profile-abc123.jpg`,
			finalObjectKey: `profiles/user-123/profile-abc123.jpg`,
			creds: loadCreds({
				S3_ACCESS_KEY_ID: `test-access`,
				S3_SECRET_ACCESS_KEY: `test-secret`,
				S3_BUCKET_NAME: `test-bucket`,
				CLOUDFLARE_ACCOUNT_ID: `test-account`,
			}),
		});

		const instance = getS3InstanceMock();
		expect(instance.copyObject).toHaveBeenCalledWith({ sourceKey: `profiles/temp/profile-abc123.jpg` }, `profiles/user-123/profile-abc123.jpg`);
		expect(instance.deleteObject).toHaveBeenCalledWith(`profiles/temp/profile-abc123.jpg`);
		expect(instance.copyObject.mock.invocationCallOrder[0]).toBeLessThan(instance.deleteObject.mock.invocationCallOrder[0]);
		expect(url).toBe(`https://assets.blissbase.app/profiles/user-123/profile-abc123.jpg`);
	});
});

describe(`getObjectPrefix`, () => {
	beforeEach(() => {
		getS3ClientMock().mockClear();
	});

	it(`reads only the requested prefix and reports the full object size`, async () => {
		const creds = loadCreds({
			S3_ACCESS_KEY_ID: `test-access`,
			S3_SECRET_ACCESS_KEY: `test-secret`,
			S3_BUCKET_NAME: `test-bucket`,
			CLOUDFLARE_ACCOUNT_ID: `test-account`,
		});
		const result = await getObjectPrefix({
			objectKey: `events/temp/abc123.webp`,
			byteLength: 12,
			creds,
		});
		const getPartialObject = getS3InstanceMock().getPartialObject;

		expect(result).toEqual({
			bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46]),
			size: 458752,
		});
		expect(getPartialObject).toHaveBeenCalledWith(`events/temp/abc123.webp`, {
			offset: 0,
			length: 12,
		});
	});
});

describe(`uploadImage`, () => {
	beforeEach(() => {
		getS3ClientMock().mockClear();
	});

	it(`stores JPEG uploads with a jpg key and JPEG content type`, async () => {
		const url = await uploadEventImage(
			Buffer.from([1, 2, 3]),
			`demo-event`,
			`abc123def45`,
			loadCreds({
				S3_ACCESS_KEY_ID: `test-access`,
				S3_SECRET_ACCESS_KEY: `test-secret`,
				S3_BUCKET_NAME: `test-bucket`,
				CLOUDFLARE_ACCOUNT_ID: `test-account`,
			}),
			`image/jpeg`,
		);

		const putObject = getPutObjectMock();
		expect(putObject).toHaveBeenCalledWith(`events/demo-event/abc123def45.jpg`, expect.any(Buffer), {
			metadata: { "Content-Type": `image/jpeg` },
		});
		expect(url).toBe(`https://assets.blissbase.app/events/demo-event/abc123def45.jpg`);
	});

	it(`rejects unsupported image content types`, async () => {
		await expect(
			uploadEventImage(
				Buffer.from([1, 2, 3]),
				`demo-event`,
				`abc123def45`,
				loadCreds({
					S3_ACCESS_KEY_ID: `test-access`,
					S3_SECRET_ACCESS_KEY: `test-secret`,
					S3_BUCKET_NAME: `test-bucket`,
					CLOUDFLARE_ACCOUNT_ID: `test-account`,
				}),
				`image/png`,
			),
		).rejects.toThrow(`Unsupported image content type: image/png`);
		expect(getS3ClientMock()).not.toHaveBeenCalled();
	});

	it(`rejects event image keys that are not compact URL-safe hashes`, async () => {
		await expect(
			uploadEventImage(
				Buffer.from([1, 2, 3]),
				`demo-event`,
				`m5k8x2q-abcdefgh`,
				loadCreds({
					S3_ACCESS_KEY_ID: `test-access`,
					S3_SECRET_ACCESS_KEY: `test-secret`,
					S3_BUCKET_NAME: `test-bucket`,
					CLOUDFLARE_ACCOUNT_ID: `test-account`,
				}),
			),
		).rejects.toThrow(`Phash must be a 11-character URL-safe hash`);
		expect(getS3ClientMock()).not.toHaveBeenCalled();
	});

	it(`uploads profile images to the profile object key`, async () => {
		const url = await uploadProfileImage({
			buffer: Buffer.from([1, 2, 3]),
			profileId: `user-123`,
			creds: loadCreds({
				S3_ACCESS_KEY_ID: `test-access`,
				S3_SECRET_ACCESS_KEY: `test-secret`,
				S3_BUCKET_NAME: `test-bucket`,
				CLOUDFLARE_ACCOUNT_ID: `test-account`,
			}),
			contentType: `image/jpeg`,
		});

		const putObject = getPutObjectMock();
		expect(putObject).toHaveBeenCalledWith(`profiles/user-123/profile.jpg`, expect.any(Buffer), {
			metadata: { "Content-Type": `image/jpeg` },
		});
		expect(url).toBe(`https://assets.blissbase.app/profiles/user-123/profile.jpg`);
	});

	it(`uploads profile banner images to the banner object key`, async () => {
		const url = await uploadProfileBannerImage({
			buffer: Buffer.from([1, 2, 3]),
			profileId: `user-123`,
			creds: loadCreds({
				S3_ACCESS_KEY_ID: `test-access`,
				S3_SECRET_ACCESS_KEY: `test-secret`,
				S3_BUCKET_NAME: `test-bucket`,
				CLOUDFLARE_ACCOUNT_ID: `test-account`,
			}),
			contentType: `image/webp`,
		});

		const putObject = getPutObjectMock();
		expect(putObject).toHaveBeenCalledWith(`profiles/user-123/banner.webp`, expect.any(Buffer), {
			metadata: { "Content-Type": `image/webp` },
		});
		expect(url).toBe(`https://assets.blissbase.app/profiles/user-123/banner.webp`);
	});
});
