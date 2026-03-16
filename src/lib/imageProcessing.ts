import sharp from 'sharp'; // blows bundle size by 15MB!!!!
import {
	EVENT_IMAGE_MAX_DIMENSION,
	EVENT_IMAGE_OUTPUT_QUALITY,
	getPerceptualHash
} from './eventImageProcessing.shared';

export async function resizeCoverImage(input: sharp.SharpInput | Array<sharp.SharpInput>): Promise<{ buffer: Buffer, phash: string }> {
	if (!input) throw new Error(`Input cannot be null or undefined`);

	try {
		const result = await sharp(input)
			.resize(EVENT_IMAGE_MAX_DIMENSION, EVENT_IMAGE_MAX_DIMENSION, {
				fit: `inside`,
				withoutEnlargement: true
			})
			.webp({ quality: Math.round(EVENT_IMAGE_OUTPUT_QUALITY * 100) })
			.toBuffer();

		if (!result || result.length === 0) {
			throw new Error(`Resize operation returned empty buffer`);
		}

		return { buffer: result, phash: await calculatePhash(result) };
	} catch (error) {
		console.error(`Error resizing image:`, error);
		throw new Error(`Failed to resize image: ${error instanceof Error ? error.message : `Unknown error`}`);
	}
}

/**
 * Convert binary hash to URL-safe string using base64 encoding
 * @param binaryHash - Binary string (0s and 1s), always 64 bits
 * @returns URL-safe base64 string
 * @example
 * binaryToAlphabet("10110100") // "BdFh"
 */
export function binaryToAlphabet(binaryHash: string): string {
    if (!binaryHash || typeof binaryHash !== 'string') {
        throw new Error('Invalid binary hash input');
    }

    if (binaryHash.length !== 64) {
        throw new Error(`Binary hash must be exactly 64 bits, got ${binaryHash.length} bits`);
    }

    // Convert binary string to bytes
    const bytes = [];
    for (let i = 0; i < binaryHash.length; i += 8) {
        const byte = binaryHash.slice(i, i + 8);
        bytes.push(parseInt(byte, 2));
    }

    // Convert bytes to Uint8Array
    const uint8Array = new Uint8Array(bytes);

    // Convert to base64 using btoa
    const base64 = btoa(String.fromCharCode(...uint8Array));

    // Make URL-safe by replacing + and / with - and _
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Convert URL-safe base64 string back to binary format
 * @param alphabetString - URL-safe base64 string
 * @returns Binary string (0s and 1s), always 64 bits
 * @example
 * alphabetToBinary("BdFh") // "10110100"
 */
export function alphabetToBinary(alphabetString: string): string {
    if (!alphabetString || typeof alphabetString !== 'string') {
        throw new Error('Invalid alphabet string input');
    }

    try {
        // Convert URL-safe base64 back to standard base64
        const base64 = alphabetString.replace(/-/g, '+').replace(/_/g, '/');

        // Add padding if needed
        const paddedBase64 = base64 + '='.repeat((4 - base64.length % 4) % 4);

        // Decode using atob
        const binaryString = atob(paddedBase64);

        // Convert to binary string
        let result = '';
        for (let i = 0; i < binaryString.length; i++) {
            const byte = binaryString.charCodeAt(i);
            result += byte.toString(2).padStart(8, '0');
        }

        // Ensure we have exactly 64 bits
        if (result.length > 64) {
            result = result.slice(0, 64);
        } else if (result.length < 64) {
            result = result.padStart(64, '0');
        }

        return result;
    } catch (error) {
        throw new Error(`Failed to decode base64 string: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export async function calculatePhash(buffer: Buffer): Promise<string> {
	if (!buffer || buffer.length === 0) {
		throw new Error(`Cannot calculate phash for empty buffer`);
	}

	try {
		const { data, info } = await sharp(buffer)
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });

		if (!info.width || !info.height) {
			throw new Error(`Invalid image dimensions for phash`);
		}

		return getPerceptualHash({
			imageData: {
				width: info.width,
				height: info.height,
				data: new Uint8ClampedArray(data)
			}
		});
	} catch (error) {
		console.error(`Error calculating phash:`, error);
		throw new Error(`Failed to calculate phash: ${error instanceof Error ? error.message : `Unknown error`}`);
	}
}

export function calculateHammingDistance(hash1: string, hash2: string): number {
	if (!hash1 || !hash2) throw new Error(`Invalid hash input`);

	const binaryHash1 = alphabetToBinary(hash1);
	const binaryHash2 = alphabetToBinary(hash2);
	let distance = 0;

	for (let i = 0; i < Math.min(binaryHash1.length, binaryHash2.length); i++) {
		if (binaryHash1[i] !== binaryHash2[i]) distance += 1;
	}

	return distance + Math.abs(binaryHash1.length - binaryHash2.length);
}