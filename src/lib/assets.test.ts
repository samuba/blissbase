import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@bradenmacdonald/s3-lite-client', () => ({
	S3Client: vi.fn().mockImplementation(() => ({
		putObject: vi.fn(),
		deleteObject: vi.fn(),
		exists: vi.fn(),
		listObjects: vi.fn()
	}))
}));

import { S3Client } from '@bradenmacdonald/s3-lite-client';
import {
	eventImageObjectKey,
	loadCreds,
	uploadEventImage,
	uploadProfileBannerImage,
	uploadProfileImage
} from '$lib/assets';

function getS3ClientMock() {
	return S3Client as unknown as {
		mockClear: () => void;
		mock: {
			results: Array<{
				value?: {
					putObject: ReturnType<typeof vi.fn>;
				};
			}>;
		};
	};
}

function getPutObjectMock() {
	const instance = getS3ClientMock().mock.results.at(-1)?.value;
	if (!instance) throw new Error(`Expected S3Client to be instantiated`);
	return instance.putObject;
}

describe(`eventImageObjectKey`, () => {
	it(`uses webp by default and jpg for JPEG uploads`, () => {
		expect(eventImageObjectKey(`demo-event`, `abc123def45`)).toBe(`events/demo-event/abc123def45.webp`);
		expect(eventImageObjectKey(`demo-event`, `abc123def45`, `image/jpeg`)).toBe(`events/demo-event/abc123def45.jpg`);
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
				CLOUDFLARE_ACCOUNT_ID: `test-account`
			}),
			`image/jpeg`
		);

		const putObject = getPutObjectMock();
		expect(putObject).toHaveBeenCalledWith(`events/demo-event/abc123def45.jpg`, expect.any(Buffer), {
			metadata: { 'Content-Type': `image/jpeg` }
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
					CLOUDFLARE_ACCOUNT_ID: `test-account`
				}),
				`image/png`
			)
		).rejects.toThrow(`Unsupported image content type: image/png`);
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
				CLOUDFLARE_ACCOUNT_ID: `test-account`
			}),
			contentType: `image/jpeg`
		});

		const putObject = getPutObjectMock();
		expect(putObject).toHaveBeenCalledWith(`profiles/user-123/profile.jpg`, expect.any(Buffer), {
			metadata: { 'Content-Type': `image/jpeg` }
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
				CLOUDFLARE_ACCOUNT_ID: `test-account`
			}),
			contentType: `image/webp`
		});

		const putObject = getPutObjectMock();
		expect(putObject).toHaveBeenCalledWith(`profiles/user-123/banner.webp`, expect.any(Buffer), {
			metadata: { 'Content-Type': `image/webp` }
		});
		expect(url).toBe(`https://assets.blissbase.app/profiles/user-123/banner.webp`);
	});
});
