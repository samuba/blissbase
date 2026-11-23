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
 * Composes the Blissbase OG poster: background, gold mark, title, gold rule, subtitle.
 * Use `variant: 'collage'` for a lighter wash so photo tiles stay visible.
 */
export async function composeOgPoster({
	title,
	subtitle,
	background,
	goldLogo,
	brandFont,
	variant = `poster`,
}: {
	title: string;
	subtitle: string;
	background: Buffer;
	goldLogo: Buffer;
	brandFont: Font;
	variant?: `poster` | `collage`;
}): Promise<Buffer> {
	const width = OG_WIDTH * SCALE;
	const height = OG_HEIGHT * SCALE;
	const px = (value: number) => Math.round(value * SCALE);
	const isCollage = variant === `collage`;

	const resizedBackground = await sharp(background).resize(width, height, { fit: `cover`, position: `right` }).png().toBuffer();

	const logoSize = px(isCollage ? 200 : 252);
	const logo = await prepareLogo({ goldLogo, size: logoSize });
	const logoBounds = await opaqueBounds(logo);

	const titleSize = safeGlyphFontSize((isCollage ? 78 : 92) * SCALE);
	const subtitlePointSize = isCollage ? 37 : 41;
	const subtitleSize = safeGlyphFontSize(subtitlePointSize * SCALE);
	const subtitleLines = wrapText({
		text: subtitle,
		font: brandFont,
		fontSize: subtitlePointSize,
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
	const textBlockHeight = titleSize + px(isCollage ? 68 : 80) + subtitleBlockHeight;

	const gap = px(isCollage ? 40 : 50);
	const groupWidth = logoBounds.width + gap + textVisualWidth;
	const groupHeight = Math.max(logoBounds.height, textBlockHeight);
	const groupX = Math.round((width - groupWidth) / 2);
	const groupY = Math.round((height - groupHeight) / 2);

	const logoX = groupX - logoBounds.minX;
	const logoY = groupY - logoBounds.minY + Math.round((groupHeight - logoBounds.height) / 2);
	const textX = groupX + logoBounds.width + gap;
	const textTop = groupY + Math.round((groupHeight - textBlockHeight) / 2);
	const titleBaseline = textTop + titleSize;
	const ruleY = titleBaseline + px(isCollage ? 22 : 26);
	const firstSubtitleBaseline = ruleY + px(isCollage ? 40 : 48);
	const titleTop = Math.round(titleBaseline - titleGlyphs.baseline);

	const pad = px(36);
	const panelX = groupX - pad;
	const panelY = groupY - pad;
	const panelW = groupWidth + pad * 2;
	const panelH = groupHeight + pad * 2;
	const washStops = isCollage
		? `
			<stop offset="0%" stop-color="#faf7f5" stop-opacity="0.18"/>
			<stop offset="50%" stop-color="#faf7f5" stop-opacity="0.28"/>
			<stop offset="100%" stop-color="#faf7f5" stop-opacity="0.22"/>
		`
		: `
			<stop offset="0%" stop-color="#faf7f5" stop-opacity="0.45"/>
			<stop offset="50%" stop-color="#faf7f5" stop-opacity="0.38"/>
			<stop offset="100%" stop-color="#faf7f5" stop-opacity="0.42"/>
		`;

	const overlay = Buffer.from(`
		<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
			<defs>
				<linearGradient id="wash" x1="0" y1="0" x2="0" y2="1">
					${washStops}
				</linearGradient>
			</defs>
			<rect width="100%" height="100%" fill="url(#wash)"/>
			${
				isCollage
					? `<rect x="${panelX}" y="${panelY}" width="${panelW}" height="${panelH}" rx="${px(28)}" fill="#faf7f5" fill-opacity="0.82"/>`
					: ``
			}
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

/**
 * Composes the home page 1200×630 OG image ("Golden Horizon") directly over the
 * event-page hero photography with the brand lockup and tagline centered
 * between the meditating hands using tight, letter-hugging drop shadows.
 */
export async function composeHomeOgPoster({
	title,
	subtitle,
	heroBackground,
	goldLogo,
	brandFont,
}: {
	title: string;
	subtitle: string;
	heroBackground: Buffer;
	goldLogo: Buffer;
	brandFont: Font;
}): Promise<Buffer> {
	const width = OG_WIDTH * SCALE;
	const height = OG_HEIGHT * SCALE;
	const px = (value: number) => Math.round(value * SCALE);

	const bg = await sharp(heroBackground)
		.resize(width, height, { fit: `cover`, position: `south` })
		.modulate({ brightness: 1, saturation: 1.04 })
		.png()
		.toBuffer();

	const logoDiameter = px(98);
	const logo = await prepareAntialiasedLogo({
		goldLogo,
		size: logoDiameter,
		shadows: [
			{ dy: px(3), blur: px(5.5), opacity: 0.65 },
			{ dy: px(1), blur: px(13), opacity: 0.32 },
		],
	});

	const titleLayer = await renderCanonicalBrandText({
		text: title,
		font: brandFont,
		fontSize: px(90),
		fill: `#faf7f5`,
		letterSpacing: px(-0.8),
		shadows: [
			{ dy: px(2), blur: px(4.5), color: `rgba(18, 9, 2, 0.72)` },
			{ dy: px(3), blur: px(11), color: `rgba(18, 9, 2, 0.44)`, strokeWidth: px(2.5) },
		],
	});
	const subtitleLayer = await renderCanonicalBrandText({
		text: subtitle,
		font: brandFont,
		fontSize: px(39),
		fill: `#faf7f5`,
		letterSpacing: px(0.2),
		shadows: [
			{ dy: px(1.5), blur: px(3.5), color: `rgba(16, 8, 2, 0.82)`, strokeWidth: px(1.2) },
			{ dy: px(2.5), blur: px(10), color: `rgba(16, 8, 2, 0.58)`, strokeWidth: px(3.5) },
		],
	});

	const logoGap = px(22);
	const lockupWidth = logoDiameter + logoGap + titleLayer.visualWidth;
	const lockupHeight = Math.max(logoDiameter, titleLayer.visualHeight);
	const lockupSubtitleGap = px(24);
	const totalBlockHeight = lockupHeight + lockupSubtitleGap + subtitleLayer.visualHeight;

	const blockCenterY = 302;
	const blockTop = Math.round(px(blockCenterY) - totalBlockHeight / 2);
	const lockupCenterY = blockTop + Math.round(lockupHeight / 2);
	const lockupX = Math.round((width - lockupWidth) / 2);

	const logoLeft = lockupX - logo.pad;
	const logoTop = Math.round(lockupCenterY - logoDiameter / 2) - logo.pad;
	const titleLeft = lockupX + logoDiameter + logoGap - titleLayer.padX;
	const titleTop = Math.round(lockupCenterY - titleLayer.visualHeight / 2) - titleLayer.padY - px(2);
	const subtitleLeft = Math.round((width - subtitleLayer.visualWidth) / 2) - subtitleLayer.padX;
	const subtitleTop = blockTop + lockupHeight + lockupSubtitleGap - subtitleLayer.padY;

	const composed = await sharp(bg)
		.composite([
			{ input: logo.png, left: logoLeft, top: logoTop },
			{ input: titleLayer.png, left: titleLeft, top: titleTop },
			{ input: subtitleLayer.png, left: subtitleLeft, top: subtitleTop },
		])
		.png()
		.toBuffer();

	return sharp(composed)
		.resize(OG_WIDTH, OG_HEIGHT, { kernel: `lanczos3` })
		.jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: `4:4:4` })
		.toBuffer();
}

async function prepareAntialiasedLogo({ goldLogo, size, shadows }: { goldLogo: Buffer; size: number; shadows: LogoShadow[] }) {
	const gold = await sharp(goldLogo)
		.ensureAlpha()
		.resize(size, size, {
			fit: `contain`,
			kernel: `lanczos3`,
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		})
		.png()
		.toBuffer();

	const mask = await sharp(
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
		.png()
		.toBuffer();

	const cleanLogo = await sharp(gold)
		.composite([{ input: mask, blend: `dest-in` }])
		.png()
		.toBuffer();

	const pad = Math.max(...shadows.map((shadow) => Math.ceil(shadow.blur * 3 + Math.abs(shadow.dy)))) + 10;
	const total = size + pad * 2;
	const darkLayers = await Promise.all(
		shadows.map((shadow) =>
			sharp(
				Buffer.from(`
					<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${total}" viewBox="${-pad} ${-pad} ${total} ${total}">
						<g transform="translate(0, ${shadow.dy}) scale(${size / 200})">
							<circle cx="100" cy="100" r="82.390" fill="none" stroke="rgba(18,10,4,${shadow.opacity})" stroke-width="23.625"/>
							<circle cx="100" cy="100" r="49.864" fill="none" stroke="rgba(18,10,4,${shadow.opacity})" stroke-width="11.427"/>
							<circle cx="100" cy="100" r="24.888" fill="none" stroke="rgba(18,10,4,${shadow.opacity})" stroke-width="8.526"/>
							<circle cx="100" cy="100" r="5.625" fill="rgba(18,10,4,${shadow.opacity})"/>
						</g>
					</svg>
				`),
			)
				.blur(Math.max(0.3, shadow.blur))
				.png()
				.toBuffer(),
		),
	);

	const png = await sharp({
		create: { width: total, height: total, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
	})
		.composite([...darkLayers.map((input) => ({ input, left: 0, top: 0 })), { input: cleanLogo, left: pad, top: pad }])
		.png()
		.toBuffer();

	return { png, pad };
}

/**
 * Builds SVG glyph outlines at native unitsPerEm inside a scaled viewBox so
 * librsvg never hits quadratic-curve tessellation bugs at specific pixel sizes.
 */
async function renderCanonicalBrandText({
	text,
	font,
	fontSize,
	fill,
	letterSpacing = 0,
	shadows,
}: {
	text: string;
	font: Font;
	fontSize: number;
	fill: string;
	letterSpacing?: number;
	shadows: TextShadow[];
}) {
	const em = font.unitsPerEm;
	const scale = fontSize / em;
	const letterSpacingEm = letterSpacing / scale;
	const glyphs = font.stringToGlyphs(text);

	let cursorX = 0;
	const paths: string[] = [];
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;

	for (let i = 0; i < glyphs.length; i++) {
		const glyph = glyphs[i]!;
		if (i > 0) cursorX += font.getKerningValue(glyphs[i - 1]!, glyph) + letterSpacingEm;
		const path = glyph.getPath(cursorX, 0, em);
		const box = path.getBoundingBox();
		if (box.x2 > box.x1 && box.y2 > box.y1) {
			paths.push(path.toSVG(1));
			if (box.x1 < minX) minX = box.x1;
			if (box.y1 < minY) minY = box.y1;
			if (box.x2 > maxX) maxX = box.x2;
			if (box.y2 > maxY) maxY = box.y2;
		}
		cursorX += glyph.advanceWidth ?? 0;
	}

	const visualWidth = Math.round((maxX - minX) * scale);
	const visualHeight = Math.round((maxY - minY) * scale);
	const padPx = Math.max(12, ...shadows.map((shadow) => Math.ceil(shadow.blur * 3 + Math.abs(shadow.dy) + (shadow.strokeWidth ?? 0)) + 10));
	const padEm = padPx / scale;

	const vbX = minX - padEm;
	const vbY = minY - padEm;
	const vbW = maxX - minX + padEm * 2;
	const vbH = maxY - minY + padEm * 2;
	const outW = Math.ceil(vbW * scale);
	const outH = Math.ceil(vbH * scale);

	const shadowLayers = await Promise.all(
		shadows.map(async (shadow) => {
			const dyEm = shadow.dy / scale;
			const strokeAttr = shadow.strokeWidth
				? ` stroke="${shadow.color}" stroke-width="${(shadow.strokeWidth / scale).toFixed(1)}" stroke-linejoin="round"`
				: ``;
			const raw = await sharp(
				Buffer.from(
					`<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="${vbX} ${vbY} ${vbW} ${vbH}"><g transform="translate(0, ${dyEm.toFixed(1)})" fill="${shadow.color}"${strokeAttr} fill-rule="nonzero">${paths.join(``)}</g></svg>`,
				),
			)
				.png()
				.toBuffer();
			return shadow.blur > 0 ? sharp(raw).blur(Math.max(0.3, shadow.blur)).png().toBuffer() : raw;
		}),
	);

	const crispText = await sharp(
		Buffer.from(
			`<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="${vbX} ${vbY} ${vbW} ${vbH}"><g fill="${fill}" fill-rule="nonzero">${paths.join(``)}</g></svg>`,
		),
	)
		.png()
		.toBuffer();

	const png = await sharp({
		create: { width: outW, height: outH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
	})
		.composite([...shadowLayers.map((input) => ({ input, left: 0, top: 0 })), { input: crispText, left: 0, top: 0 }])
		.png()
		.toBuffer();

	return { png, visualWidth, visualHeight, padX: padPx, padY: padPx };
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
	const size = safeGlyphFontSize(fontSize);
	const chars = [...text];
	const parts = chars.map((char) =>
		char === ` `
			? {
					svg: null,
					padding: 0,
					baseline: 0,
					advance: font.getAdvanceWidth(` `, size),
					height: 0,
				}
			: renderWordPath({ text: char, font, fontSize: size, fill }),
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
		advance: font.getAdvanceWidth(text, size),
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

/** librsvg drops some Baloo glyphs at a few exact px sizes (e.g. `i` at 72). */
function safeGlyphFontSize(fontSize: number) {
	if (fontSize === 72 || fontSize === 87 || fontSize === 88) return fontSize + 1;
	return fontSize;
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

type LogoShadow = {
	dy: number;
	blur: number;
	opacity: number;
};

type TextShadow = {
	dy: number;
	blur: number;
	color: string;
	strokeWidth?: number;
};
