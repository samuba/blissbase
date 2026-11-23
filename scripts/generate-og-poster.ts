import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";
import { composeHomeOgPoster, composeOgPoster } from "../src/lib/server/og/ogPoster.ts";
import { compressPngWithTinyPng } from "../src/lib/server/og/tinyPng.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), `..`);
const fontFile = readFileSync(resolve(root, `src/lib/fonts/Baloo2-Medium.ttf`));
const brandFont = opentype.parse(fontFile.buffer.slice(fontFile.byteOffset, fontFile.byteOffset + fontFile.byteLength));

const homePoster = await composeHomeOgPoster({
	title: `Blissbase`,
	subtitle: `Find conscious events near you`,
	heroBackground: readFileSync(resolve(root, `src/lib/assets/testcover2.jpeg`)),
	goldLogo: readFileSync(resolve(root, `static/logo-gold-foil.png`)),
	brandFont,
});
writeFileSync(resolve(root, `static/og-poster.jpg`), homePoster);
console.log(`wrote static/og-poster.jpg (${homePoster.length} bytes)`);

if (process.argv.includes(`--offerings`)) {
	await import("varlock/auto-load");
	const offeringsPng = await composeOgPoster({
		title: `Blissbase`,
		subtitle: `Find conscious offerings near you`,
		background: readFileSync(resolve(root, `src/lib/server/og/og-poster-bg.jpg`)),
		goldLogo: readFileSync(resolve(root, `static/logo-gold.png`)),
		brandFont,
	});
	const compressed = await compressPngWithTinyPng({ png: offeringsPng });
	writeFileSync(resolve(root, `static/og-poster-offerings.png`), compressed);
	console.log(`wrote static/og-poster-offerings.png (${offeringsPng.length} → ${compressed.length} bytes)`);
}
