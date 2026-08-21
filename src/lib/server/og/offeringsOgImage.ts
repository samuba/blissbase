import opentype from "opentype.js";
import sharp from "sharp";
import backgroundDataUrl from "./og-poster-bg.jpg?inline";
import goldLogoDataUrl from "../../../../static/logo-gold.png?inline";
import brandFontDataUrl from "$lib/fonts/Baloo2-Medium.ttf?inline";
import { composeOgPoster } from "./ogPoster";

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const MAX_COVERS = 15;
/** Max fraction of a tile that may sit outside the canvas (⇒ ≥70% stays visible). */
const MAX_TILE_OVERHANG = 0.3;

const brandFont = opentype.parse(dataUrlToArrayBuffer(brandFontDataUrl));
const plasterBackground = dataUrlToBuffer(backgroundDataUrl);
const goldLogo = dataUrlToBuffer(goldLogoDataUrl);

/**
 * Builds a WhatsApp-friendly 1200×630 OG image: offering covers as collage
 * with the Blissbase poster branding on top. Falls back to the plaster poster
 * when no covers load.
 */
export async function createOfferingsOgImage({
	imageUrls,
	locationLabel,
}: {
	imageUrls: string[];
	locationLabel?: string | null;
}): Promise<Buffer> {
	const place = locationLabel?.trim();
	const subtitle = place ? `Find conscious offerings in ${place}` : `Find conscious offerings near you`;
	const urls = shuffleItems(imageUrls.map((url) => url.trim()).filter(Boolean)).slice(0, MAX_COVERS);
	const collage = urls.length ? await buildCollageBackground({ imageUrls: urls }) : null;

	const png = await composeOgPoster({
		title: `Blissbase`,
		subtitle,
		background: collage ?? plasterBackground,
		goldLogo,
		brandFont,
		variant: collage ? `collage` : `poster`,
	});
	return sharp(png).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
}

async function buildCollageBackground({ imageUrls }: { imageUrls: string[] }) {
	const count = imageUrls.length;
	const gap = 3;
	const { cols, rows } = optimalCollageGrid({ count, gap });
	const cellSize = Math.floor(squareTileSize({ cols, rows, gap }));

	const tiles = (
		await Promise.all(
			imageUrls.map(async (url) => {
				try {
					return await loadCoverTile({ url, size: cellSize });
				} catch (error) {
					console.error(`Failed to load OG collage image ${url}:`, error);
					return null;
				}
			}),
		)
	).filter((tile): tile is Buffer => Boolean(tile));

	if (!tiles.length) return null;

	const gridWidth = cols * cellSize + (cols - 1) * gap;
	const gridHeight = rows * cellSize + (rows - 1) * gap;
	const offsetX = Math.round((OG_WIDTH - gridWidth) / 2);
	const offsetY = Math.round((OG_HEIGHT - gridHeight) / 2);

	const composites = tiles.map((tile, index) => {
		const col = index % cols;
		const row = Math.floor(index / cols);
		return {
			input: tile,
			left: offsetX + col * (cellSize + gap),
			top: offsetY + row * (cellSize + gap),
		};
	});

	return sharp({
		create: {
			width: OG_WIDTH,
			height: OG_HEIGHT,
			channels: 3,
			background: hexToRgb(`#854d0e`),
		},
	})
		.composite(composites)
		.png()
		.toBuffer();
}

async function loadCoverTile({ url, size }: { url: string; size: number }) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const input = Buffer.from(await response.arrayBuffer());
	const radius = Math.round(size * 0.08);

	const fitted = await sharp(input)
		.rotate()
		.resize(size, size, {
			fit: `cover`,
			position: `centre`,
		})
		.png()
		.toBuffer();

	const roundedMask = Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
			<rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/>
		</svg>`,
	);

	return sharp(fitted)
		.composite([{ input: roundedMask, blend: `dest-in` }])
		.png()
		.toBuffer();
}

function optimalCollageGrid({ count, gap }: { count: number; gap: number }) {
	if (count <= 1) return { cols: 1, rows: 1 };

	const targetAspect = OG_WIDTH / OG_HEIGHT;
	let best = { cols: count, rows: 1, score: Number.POSITIVE_INFINITY };

	for (let cols = 1; cols <= count; cols++) {
		const rows = Math.ceil(count / cols);
		const empty = cols * rows - count;
		const layoutAspect = cols / rows;
		const aspectDiff = Math.abs(layoutAspect - targetAspect);
		const coverSize = coverTileSize({ cols, rows, gap });
		const maxSize = maxTileSizeForVisibility({ cols, rows, gap });
		const fitsVisibility = coverSize <= maxSize + 1e-6;
		const overhangRatio = fitsVisibility ? 0 : coverSize / maxSize - 1;
		const portraitOrSquarePenalty = rows >= cols && count >= 5 ? 4 : 0;
		const tooManyRowsPenalty = Math.max(0, rows - 3) * 1.5;

		const score = empty * 1.2 + aspectDiff * 2 + portraitOrSquarePenalty + tooManyRowsPenalty + (fitsVisibility ? 0 : 2 + overhangRatio);

		if (score < best.score) {
			best = { cols, rows, score };
		}
	}

	return { cols: best.cols, rows: best.rows };
}

function coverTileSize({ cols, rows, gap }: { cols: number; rows: number; gap: number }) {
	return Math.max((OG_WIDTH - (cols - 1) * gap) / cols, (OG_HEIGHT - (rows - 1) * gap) / rows);
}

function maxTileSizeForVisibility({ cols, rows, gap }: { cols: number; rows: number; gap: number }) {
	const maxFromWidth = cols <= 1 ? OG_WIDTH / (1 - 2 * MAX_TILE_OVERHANG) : (OG_WIDTH - (cols - 1) * gap) / (cols - 2 * MAX_TILE_OVERHANG);
	const maxFromHeight =
		rows <= 1 ? OG_HEIGHT / (1 - 2 * MAX_TILE_OVERHANG) : (OG_HEIGHT - (rows - 1) * gap) / (rows - 2 * MAX_TILE_OVERHANG);
	return Math.min(maxFromWidth, maxFromHeight);
}

function squareTileSize({ cols, rows, gap }: { cols: number; rows: number; gap: number }) {
	const coverSize = coverTileSize({ cols, rows, gap });
	const maxSize = maxTileSizeForVisibility({ cols, rows, gap });
	return Math.max(1, Math.min(coverSize, maxSize));
}

function hexToRgb(hex: string) {
	const value = hex.replace(`#`, ``);
	return {
		r: Number.parseInt(value.slice(0, 2), 16),
		g: Number.parseInt(value.slice(2, 4), 16),
		b: Number.parseInt(value.slice(4, 6), 16),
	};
}

function shuffleItems<T>(items: T[]) {
	const result = [...items];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[result[i], result[j]] = [result[j]!, result[i]!];
	}
	return result;
}

function dataUrlToBuffer(dataUrl: string) {
	const comma = dataUrl.indexOf(`,`);
	return Buffer.from(dataUrl.slice(comma + 1), `base64`);
}

function dataUrlToArrayBuffer(dataUrl: string) {
	const { buffer, byteOffset, byteLength } = dataUrlToBuffer(dataUrl);
	return buffer.slice(byteOffset, byteOffset + byteLength);
}
