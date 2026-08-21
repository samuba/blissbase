import opentype from 'opentype.js';
import sharp from 'sharp';
import logoDataUrl from './blissbase-logo-transparent.png?inline';
import brandFontDataUrl from '$lib/fonts/Baloo2-Medium.ttf?inline';

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const PRIMARY = `#eab308`;
const TEXT = `#713f12`;
const MAX_COVERS = 15;
const brandFont = opentype.parse(dataUrlToArrayBuffer(brandFontDataUrl));

/**
 * Builds a WhatsApp-friendly 1200×630 OG image: offering covers as collage
 * background with Blissbase offerings branding on top.
 */
export async function createOfferingsOgImage({
	imageUrls,
	locationLabel,
}: {
	imageUrls: string[];
	locationLabel?: string | null;
}): Promise<Buffer> {
	const urls = shuffleItems(imageUrls.map((url) => url.trim()).filter(Boolean)).slice(
		0,
		MAX_COVERS,
	);
	const collage = urls.length
		? await buildCollageBackground({ imageUrls: urls })
		: await solidBrandBackground();

	const branding = await buildBrandingOverlay({ locationLabel });

	return sharp(collage)
		.composite([
			{ input: await softYellowWash(), blend: `over` },
			{ input: branding, blend: `over` },
		])
		.jpeg({ quality: 84, mozjpeg: true })
		.toBuffer();
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

	if (!tiles.length) return solidBrandBackground();

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
		.jpeg()
		.toBuffer();
}

/**
 * Fits each cover into a 1:1 cell with `cover`.
 */
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

/** Max fraction of a tile that may sit outside the canvas (⇒ ≥70% stays visible). */
const MAX_TILE_OVERHANG = 0.3;

/**
 * Picks an optimal cols×rows layout for the landscape OG frame.
 * Prefers wide grids that fill neatly (e.g. 6→3×2, 9→5×2).
 */
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

		// Prefer landscape (cols > rows) for this wide OG canvas; avoid square/tall grids.
		const portraitOrSquarePenalty = rows >= cols && count >= 5 ? 4 : 0;
		const tooManyRowsPenalty = Math.max(0, rows - 3) * 1.5;

		const score =
			empty * 1.2 +
			aspectDiff * 2 +
			portraitOrSquarePenalty +
			tooManyRowsPenalty +
			(fitsVisibility ? 0 : 2 + overhangRatio);

		if (score < best.score) {
			best = { cols, rows, score };
		}
	}

	return { cols: best.cols, rows: best.rows };
}

/** Smallest square size that makes the grid cover the full OG canvas. */
function coverTileSize({ cols, rows, gap }: { cols: number; rows: number; gap: number }) {
	return Math.max(
		(OG_WIDTH - (cols - 1) * gap) / cols,
		(OG_HEIGHT - (rows - 1) * gap) / rows,
	);
}

/**
 * Largest square size where centered overhang stays ≤ 30% of the tile
 * on each side (≥ 70% of each edge tile remains visible).
 */
function maxTileSizeForVisibility({ cols, rows, gap }: { cols: number; rows: number; gap: number }) {
	const maxFromWidth =
		cols <= 1
			? OG_WIDTH / (1 - 2 * MAX_TILE_OVERHANG)
			: (OG_WIDTH - (cols - 1) * gap) / (cols - 2 * MAX_TILE_OVERHANG);
	const maxFromHeight =
		rows <= 1
			? OG_HEIGHT / (1 - 2 * MAX_TILE_OVERHANG)
			: (OG_HEIGHT - (rows - 1) * gap) / (rows - 2 * MAX_TILE_OVERHANG);
	return Math.min(maxFromWidth, maxFromHeight);
}

/** Square tile size: cover the canvas when possible, never exceed 30% overhang. */
function squareTileSize({ cols, rows, gap }: { cols: number; rows: number; gap: number }) {
	const coverSize = coverTileSize({ cols, rows, gap });
	const maxSize = maxTileSizeForVisibility({ cols, rows, gap });
	return Math.max(1, Math.min(coverSize, maxSize));
}

async function solidBrandBackground() {
	return sharp({
		create: {
			width: OG_WIDTH,
			height: OG_HEIGHT,
			channels: 3,
			background: hexToRgb(PRIMARY),
		},
	})
		.jpeg()
		.toBuffer();
}

async function softYellowWash() {
	const svg = `
		<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}">
			<defs>
				<linearGradient id="wash" x1="0" y1="0" x2="1" y2="1">
					<stop offset="0%" stop-color="${PRIMARY}" stop-opacity="0.10"/>
					<stop offset="55%" stop-color="${PRIMARY}" stop-opacity="0.18"/>
					<stop offset="100%" stop-color="#422006" stop-opacity="0.40"/>
				</linearGradient>
				<linearGradient id="bottom" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stop-color="#422006" stop-opacity="0"/>
					<stop offset="100%" stop-color="#422006" stop-opacity="0.22"/>
				</linearGradient>
			</defs>
			<rect width="100%" height="100%" fill="url(#wash)"/>
			<rect width="100%" height="100%" fill="url(#bottom)"/>
			<path d="M0 545 C 180 500, 320 590, 520 555 C 740 515, 900 600, 1200 540 L 1200 630 L 0 630 Z" fill="${PRIMARY}" fill-opacity="0.18"/>
			<path d="M0 575 C 220 545, 380 610, 620 575 C 860 540, 980 605, 1200 570 L 1200 630 L 0 630 Z" fill="#faf7f5" fill-opacity="0.14"/>
		</svg>
	`;
	return Buffer.from(svg);
}

async function buildBrandingOverlay({ locationLabel }: { locationLabel?: string | null }) {
	const logoSize = 52;
	const logo = await sharp(dataUrlToBuffer(logoDataUrl))
		.resize(logoSize, logoSize, { fit: `contain`, background: { r: 0, g: 0, b: 0, alpha: 0 } })
		.png()
		.toBuffer();

	const title = `Conscious Offerings`;
	const subtitle = locationLabel?.trim() ? `in ${locationLabel.trim()}` : `near you`;
	const brandText = `Blissbase.app`;

	const cardWidth = 500;
	const cardHeight = 250;
	const cardX = (OG_WIDTH - cardWidth) / 2;
	const cardY = (OG_HEIGHT - cardHeight) / 2;

	const brandGap = 12;
	const brandFontSize = 34;
	const brandTextWidth = brandFont.getAdvanceWidth(brandText, brandFontSize);
	const brandGroupWidth = logoSize + brandGap + brandTextWidth;
	const brandGroupX = Math.round((OG_WIDTH - brandGroupWidth) / 2);
	const brandRowTop = Math.round(cardY + 168);
	const brandTextBaseline = brandRowTop + 36;

	const textSvg = Buffer.from(`
		<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}">
			<defs>
				<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
					<feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000" flood-opacity="0.2"/>
				</filter>
			</defs>
			<rect x="${cardX}" y="${cardY}" width="${cardWidth}" height="${cardHeight}" rx="26" fill="#faf7f5" fill-opacity="0.75" filter="url(#shadow)"/>
			${svgTextPath({ text: title, x: OG_WIDTH / 2, y: cardY + 70, fontSize: 48, anchor: `middle`, fill: TEXT })}
			${svgTextPath({ text: subtitle, x: OG_WIDTH / 2, y: cardY + 132, fontSize: 46, anchor: `middle`, fill: TEXT, fillOpacity: 0.88 })}
			${svgTextPath({ text: brandText, x: brandGroupX + logoSize + brandGap, y: brandTextBaseline, fontSize: brandFontSize, fill: TEXT })}
		</svg>
	`);

	return sharp(textSvg)
		.composite([{ input: logo, top: brandRowTop, left: brandGroupX }])
		.png()
		.toBuffer();
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

function svgTextPath({
	text,
	x,
	y,
	fontSize,
	anchor = `start`,
	fill,
	fillOpacity = 1,
}: {
	text: string;
	x: number;
	y: number;
	fontSize: number;
	anchor?: `start` | `middle`;
	fill: string;
	fillOpacity?: number;
}) {
	const width = brandFont.getAdvanceWidth(text, fontSize);
	const startX = anchor === `middle` ? x - width / 2 : x;
	return brandFont
		.getPath(text, startX, y, fontSize)
		.toSVG(2)
		.replace(`<path`, `<path fill="${fill}" fill-opacity="${fillOpacity}"`);
}
