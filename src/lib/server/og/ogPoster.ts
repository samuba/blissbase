import type { Font } from "opentype.js";
import sharp from "sharp";

const SCALE = 2;
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const PRIMARY = `#eab308`;
const TEXT = `#713f12`;
/** oklch(42.1% 0.095 57.708) — hex for sharp/SVG */
const TEXT_SOFT = `#733e0a`;
const MAX_SUBTITLE_WIDTH = 640;

/**
 * Composes the Blissbase OG poster: plaster background, gold mark, title, gold rule, subtitle.
 */
export async function composeOgPoster({
	title,
	subtitle,
	background,
	goldLogo,
	brandFont,
}: {
	title: string;
	subtitle: string;
	background: Buffer;
	goldLogo: Buffer;
	brandFont: Font;
}): Promise<Buffer> {
	const width = OG_WIDTH * SCALE;
	const height = OG_HEIGHT * SCALE;
	const px = (value: number) => Math.round(value * SCALE);

	const resizedBackground = await sharp(background).resize(width, height, { fit: `cover`, position: `right` }).png().toBuffer();

	const logoSize = px(252);
	const logo = await prepareLogo({ goldLogo, size: logoSize });
	const logoBounds = await opaqueBounds(logo);

	const titleSize = 92 * SCALE;
	const subtitleSize = 41 * SCALE;
	const subtitleLines = wrapText({
		text: subtitle,
		font: brandFont,
		fontSize: 41,
		maxWidth: MAX_SUBTITLE_WIDTH,
	});
	const subtitleLineHeight = Math.round(subtitleSize * 1.2);
	const subtitleBlockHeight = subtitleSize + (subtitleLines.length - 1) * subtitleLineHeight;

	const titleGlyphs = await renderBrandText({
		text: title,
		font: brandFont,
		fontSize: titleSize,
		fill: TEXT,
	});
	const subtitleGlyphs = await Promise.all(
		subtitleLines.map((line) =>
			renderBrandText({
				text: line,
				font: brandFont,
				fontSize: subtitleSize,
				fill: TEXT_SOFT,
			}),
		),
	);
	const titleBounds = await opaqueBounds(titleGlyphs.png);
	const subtitleBounds = await Promise.all(subtitleGlyphs.map((glyphs) => opaqueBounds(glyphs.png)));
	const textVisualWidth = Math.max(titleBounds.width, ...subtitleBounds.map((bounds) => bounds.width));
	const textBlockHeight = titleSize + px(80) + subtitleBlockHeight;

	const gap = px(50);
	const groupWidth = logoBounds.width + gap + textVisualWidth;
	const groupHeight = Math.max(logoBounds.height, textBlockHeight);
	const groupX = Math.round((width - groupWidth) / 2);
	const groupY = Math.round((height - groupHeight) / 2);

	const logoX = groupX - logoBounds.minX;
	const logoY = groupY - logoBounds.minY + Math.round((groupHeight - logoBounds.height) / 2);
	const textX = groupX + logoBounds.width + gap;
	const textTop = groupY + Math.round((groupHeight - textBlockHeight) / 2);
	const titleBaseline = textTop + titleSize;
	const ruleY = titleBaseline + px(26);
	const firstSubtitleBaseline = ruleY + px(48);
	const titleTop = Math.round(titleBaseline - titleGlyphs.baseline);

	const overlay = Buffer.from(`
		<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
			<defs>
				<linearGradient id="wash" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stop-color="#faf7f5" stop-opacity="0.45"/>
					<stop offset="50%" stop-color="#faf7f5" stop-opacity="0.38"/>
					<stop offset="100%" stop-color="#faf7f5" stop-opacity="0.42"/>
				</linearGradient>
			</defs>
			<rect width="100%" height="100%" fill="url(#wash)"/>
			<rect x="${textX}" y="${ruleY}" width="${px(100)}" height="${px(3)}" rx="${1.5 * SCALE}" fill="${PRIMARY}"/>
		</svg>
	`);

	const composed = await sharp(resizedBackground)
		.composite([
			{ input: overlay, blend: `over` },
			{ input: logo, left: logoX, top: logoY },
			{
				input: titleGlyphs.png,
				left: textX - titleBounds.minX,
				top: titleTop,
			},
			...subtitleGlyphs.map((glyphs, index) => ({
				input: glyphs.png,
				left: textX - (subtitleBounds[index]?.minX ?? 0),
				top: Math.round(firstSubtitleBaseline + index * subtitleLineHeight - glyphs.baseline),
			})),
		])
		.png()
		.toBuffer();

	return sharp(composed).resize(OG_WIDTH, OG_HEIGHT, { kernel: `lanczos3` }).png({ compressionLevel: 9 }).toBuffer();
}

async function prepareLogo({ goldLogo, size }: { goldLogo: Buffer; size: number }) {
	const gold = await sharp(goldLogo)
		.ensureAlpha()
		.resize(size, size, {
			fit: `contain`,
			kernel: `lanczos3`,
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		})
		.png()
		.toBuffer();

	const maskRaw = await sharp(
		Buffer.from(`
			<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 200 200">
				<circle cx="100" cy="100" r="82.390" fill="none" stroke="#fff" stroke-width="23.625"/>
				<circle cx="100" cy="100" r="49.864" fill="none" stroke="#fff" stroke-width="11.427"/>
				<circle cx="100" cy="100" r="24.888" fill="none" stroke="#fff" stroke-width="8.526"/>
				<circle cx="100" cy="100" r="5.625" fill="#fff"/>
			</svg>
		`),
	)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });

	for (let i = 3; i < maskRaw.data.length; i += 4) {
		maskRaw.data[i] = (maskRaw.data[i] ?? 0) < 160 ? 0 : 255;
	}

	const mask = await sharp(maskRaw.data, {
		raw: { width: size, height: size, channels: 4 },
	})
		.png()
		.toBuffer();

	return sharp(gold)
		.composite([{ input: mask, blend: `dest-in` }])
		.png()
		.toBuffer();
}

async function renderBrandText({ text, font, fontSize, fill }: { text: string; font: Font; fontSize: number; fill: string }) {
	const chars = [...text];
	const parts = chars.map((char) =>
		char === ` `
			? {
					svg: null,
					padding: 0,
					baseline: 0,
					advance: font.getAdvanceWidth(` `, fontSize),
					height: 0,
				}
			: renderWordPath({ text: char, font, fontSize, fill }),
	);
	const drawn = parts.filter((part) => part.svg);
	const padding = Math.max(...drawn.map((part) => part.padding));
	const baseline = Math.max(...drawn.map((part) => part.baseline));
	const height = Math.ceil(Math.max(...drawn.map((part) => part.height + (baseline - part.baseline))));
	const width = Math.ceil(parts.reduce((sum, part) => sum + part.advance, 0) + padding * 2);

	let x = padding;
	const composites = (
		await Promise.all(
			parts.map(async (part) => {
				const left = Math.round(x);
				x += part.advance;
				if (!part.svg) return null;
				return {
					input: await sharp(Buffer.from(part.svg)).png().toBuffer(),
					left,
					top: Math.round(baseline - part.baseline),
				};
			}),
		)
	).filter((part) => part !== null);

	return {
		png: await sharp({
			create: {
				width,
				height,
				channels: 4,
				background: { r: 0, g: 0, b: 0, alpha: 0 },
			},
		})
			.composite(composites)
			.png()
			.toBuffer(),
		padding,
		baseline,
		advance: font.getAdvanceWidth(text, fontSize),
	};
}

function renderWordPath({ text, font, fontSize, fill }: { text: string; font: Font; fontSize: number; fill: string }) {
	const padding = Math.ceil(fontSize * 0.08);
	const unpositioned = font.getPath(text, padding, 0, fontSize);
	const rawBox = unpositioned.getBoundingBox();
	const baseline = padding - rawBox.y1;
	const path = font.getPath(text, padding, baseline, fontSize);
	const box = path.getBoundingBox();
	const width = Math.ceil(box.x2) + padding;
	const height = Math.ceil(box.y2) + padding;

	return {
		svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${path.toSVG(3).replace(`<path`, `<path fill="${fill}"`)}</svg>`,
		padding,
		baseline,
		advance: font.getAdvanceWidth(text, fontSize),
		height,
	};
}

function wrapText({ text, font, fontSize, maxWidth }: { text: string; font: Font; fontSize: number; maxWidth: number }) {
	const words = text.split(/\s+/).filter(Boolean);
	if (!words.length) return [text];

	const lines: string[] = [];
	let current = ``;
	for (const word of words) {
		const next = current ? `${current} ${word}` : word;
		if (!current || font.getAdvanceWidth(next, fontSize) <= maxWidth) {
			current = next;
			continue;
		}
		lines.push(current);
		current = word;
	}
	if (current) lines.push(current);
	return lines;
}

async function opaqueBounds(png: Buffer) {
	const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
	let minX = info.width;
	let minY = info.height;
	let maxX = 0;
	let maxY = 0;

	for (let y = 0; y < info.height; y++) {
		for (let x = 0; x < info.width; x++) {
			if ((data[(y * info.width + x) * 4 + 3] ?? 0) < 10) continue;
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		}
	}

	return {
		minX,
		minY,
		maxX,
		maxY,
		width: maxX - minX + 1,
		height: maxY - minY + 1,
	};
}
