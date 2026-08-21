import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";
import { composeOgPoster } from "../src/lib/server/og/ogPoster";
import { compressPngWithTinyPng } from "../src/lib/server/og/tinyPng";

const root = resolve(dirname(fileURLToPath(import.meta.url)), `..`);
const fontFile = readFileSync(resolve(root, `src/lib/fonts/Baloo2-Medium.ttf`));
const brandFont = opentype.parse(fontFile.buffer.slice(fontFile.byteOffset, fontFile.byteOffset + fontFile.byteLength));
const background = readFileSync(resolve(root, `src/lib/server/og/og-poster-bg.jpg`));
const goldLogo = readFileSync(resolve(root, `static/logo-gold.png`));

const posters = [
	{
		file: `static/og-poster.png`,
		subtitle: `Find conscious events near you`,
	},
	{
		file: `static/og-poster-offerings.png`,
		subtitle: `Find conscious offerings near you`,
	},
];

for (const poster of posters) {
	const png = await composeOgPoster({
		title: `Blissbase`,
		subtitle: poster.subtitle,
		background,
		goldLogo,
		brandFont,
	});
	const compressed = await compressPngWithTinyPng({ png });
	writeFileSync(resolve(root, poster.file), compressed);
	console.log(`wrote ${poster.file} (${png.length} → ${compressed.length} bytes)`);
}
