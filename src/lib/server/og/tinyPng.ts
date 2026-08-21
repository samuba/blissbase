/**
 * Compresses a PNG with TinyPNG and returns only that result.
 */
export async function compressPngWithTinyPng({ png, apiKey }: { png: Buffer; apiKey?: string }) {
	if (process.env.VITEST) return png;

	const key = apiKey || process.env.TINIFY_API_KEY || process.env.TINIFY_KEY;
	if (!key) throw new Error(`Set TINIFY_API_KEY to compress images with TinyPNG`);

	const authorization = `Basic ${Buffer.from(`api:${key}`).toString(`base64`)}`;
	const shrink = await fetch(`https://api.tinify.com/shrink`, {
		method: `POST`,
		headers: { Authorization: authorization },
		body: png,
	});
	if (!shrink.ok) {
		throw new Error(`TinyPNG shrink failed: ${shrink.status} ${await shrink.text()}`);
	}

	const location = shrink.headers.get(`location`);
	if (!location) throw new Error(`TinyPNG shrink did not return a Location`);

	const output = await fetch(location, {
		headers: { Authorization: authorization },
	});
	if (!output.ok) {
		throw new Error(`TinyPNG download failed: ${output.status} ${await output.text()}`);
	}

	return Buffer.from(await output.arrayBuffer());
}
