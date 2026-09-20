import { describe, expect, it } from 'vitest';
import {
	getProcessedImageHashFromFileName,
	getProcessedImageHashFromUrl,
	isProcessedImageHash,
} from './imageUpload.shared';

describe(`isProcessedImageHash`, () => {
	it(`accepts compact URL-safe hashes and rejects gallery timestamp suffixes`, () => {
		expect(isProcessedImageHash(`abc123def45`)).toBe(true);
		expect(isProcessedImageHash(`LOZTvW10y7U`)).toBe(true);
		expect(isProcessedImageHash(`m5k8x2q-abcdefgh`)).toBe(false);
		expect(isProcessedImageHash(`image`)).toBe(false);
	});
});

describe(`getProcessedImageHashFromFileName`, () => {
	it(`reads the hash prefix from processed and scrape file names`, () => {
		expect(getProcessedImageHashFromFileName({ fileName: `abc123def45.webp` })).toBe(`abc123def45`);
		expect(getProcessedImageHashFromFileName({ fileName: `abc123def45-cover.webp` })).toBe(`abc123def45`);
		expect(getProcessedImageHashFromFileName({ fileName: `m5k8x2q-abcdefgh.webp` })).toBeUndefined();
	});
});

describe(`getProcessedImageHashFromUrl`, () => {
	it(`extracts hashes from asset URLs and ignores original filenames`, () => {
		expect(
			getProcessedImageHashFromUrl({
				url: `https://assets.blissbase.app/events/demo/abc123def45.webp`,
			}),
		).toBe(`abc123def45`);
		expect(
			getProcessedImageHashFromUrl({
				url: `https://cdn.example.com/image.jpg`,
			}),
		).toBeUndefined();
	});
});
