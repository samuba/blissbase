import { beforeEach, describe, expect, it, vi } from 'vitest';

const { putObject } = vi.hoisted(() => ({
	putObject: vi.fn()
}));

vi.mock('@bradenmacdonald/s3-lite-client', () => ({
	S3Client: vi.fn().mockImplementation(() => ({
		putObject,
		deleteObject: vi.fn(),
		exists: vi.fn(),
		listObjects: vi.fn()
	}))
}));

import { eventImageObjectKey, loadCreds, uploadImage } from '$lib/assets';

describe(`eventImageObjectKey`, () => {
	it(`uses webp by default and jpg for JPEG uploads`, () => {
		expect(eventImageObjectKey(`demo-event`, `abc123def45`)).toBe(`events/demo-event/abc123def45.webp`);
		expect(eventImageObjectKey(`demo-event`, `abc123def45`, `image/jpeg`)).toBe(`events/demo-event/abc123def45.jpg`);
	});
});

describe(`uploadImage`, () => {
	beforeEach(() => {
		putObject.mockReset();
		putObject.mockResolvedValue(undefined);
	});

	it(`stores JPEG uploads with a jpg key and JPEG content type`, async () => {
		const url = await uploadImage(
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

		expect(putObject).toHaveBeenCalledWith(`events/demo-event/abc123def45.jpg`, expect.any(Buffer), {
			metadata: { 'Content-Type': `image/jpeg` }
		});
		expect(url).toBe(`https://assets.blissbase.app/events/demo-event/abc123def45.jpg`);
	});

	it(`rejects unsupported image content types`, async () => {
		await expect(
			uploadImage(
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
		expect(putObject).not.toHaveBeenCalled();
	});
});
