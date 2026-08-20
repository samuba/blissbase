import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import opentype from 'opentype.js'
import sharp from 'sharp'

const SCALE = 2
const OG_WIDTH = 1200
const OG_HEIGHT = 630
const PRIMARY = `#eab308`
const TEXT = `#713f12`
const TEXT_SOFT = `#8a5a24`

const root = resolve(dirname(fileURLToPath(import.meta.url)), `..`)
const fontPath = resolve(root, `src/lib/fonts/Baloo2-SemiBold.ttf`)
const fontFile = readFileSync(fontPath)
const brandFont = opentype.parse(
	fontFile.buffer.slice(fontFile.byteOffset, fontFile.byteOffset + fontFile.byteLength),
)
const fontDataUrl = `data:font/truetype;base64,${fontFile.toString(`base64`)}`

const title = `Blissbase`
const subtitle = `Find conscious events near you`

await writeOgPoster()

async function writeOgPoster() {
	const width = OG_WIDTH * SCALE
	const height = OG_HEIGHT * SCALE
	const px = (value: number) => Math.round(value * SCALE)

	const background = await sharp(resolve(root, `scripts/og-poster-bg.jpg`))
		.resize(width, height, { fit: `cover`, position: `right` })
		.png()
		.toBuffer()

	const logoSize = px(276)
	const logo = await prepareLogo(logoSize)

	const titleSize = 84 * SCALE
	const subtitleSize = 34 * SCALE
	const titleWidth = brandFont.getAdvanceWidth(title, titleSize)
	const subtitleWidth = brandFont.getAdvanceWidth(subtitle, subtitleSize)
	const textBlockWidth = Math.max(titleWidth, subtitleWidth)
	const textBlockHeight = titleSize + px(54) + subtitleSize

	const gap = px(56)
	const groupWidth = logoSize + gap + textBlockWidth
	const groupX = Math.round((width - groupWidth) / 2)
	const logoX = groupX
	const logoY = Math.round((height - logoSize) / 2)
	const textX = logoX + logoSize + gap
	const textTop = logoY + Math.round((logoSize - textBlockHeight) / 2) + px(10)
	const titleBaseline = textTop + titleSize
	const ruleY = titleBaseline + px(16)
	const subtitleBaseline = ruleY + px(38)

	const overlay = Buffer.from(`
		<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
			<defs>
				<style>
					@font-face {
						font-family: "Baloo2";
						src: url("${fontDataUrl}") format("truetype");
					}
				</style>
				<linearGradient id="wash" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stop-color="#faf7f5" stop-opacity="0.45"/>
					<stop offset="50%" stop-color="#faf7f5" stop-opacity="0.38"/>
					<stop offset="100%" stop-color="#faf7f5" stop-opacity="0.42"/>
				</linearGradient>
			</defs>
			<rect width="100%" height="100%" fill="url(#wash)"/>
			<rect x="${textX}" y="${ruleY}" width="${px(96)}" height="${px(3)}" rx="${1.5 * SCALE}" fill="${PRIMARY}"/>
			<text x="${textX}" y="${titleBaseline}" font-family="Baloo2" font-size="${titleSize}" fill="${TEXT}">${title}</text>
			<text x="${textX}" y="${subtitleBaseline}" font-family="Baloo2" font-size="${subtitleSize}" fill="${TEXT_SOFT}">${subtitle}</text>
		</svg>
	`)

	const composed = await sharp(background)
		.composite([
			{ input: overlay, blend: `over` },
			{ input: logo, left: logoX, top: logoY },
		])
		.png()
		.toBuffer()

	await sharp(composed)
		.resize(OG_WIDTH, OG_HEIGHT, { kernel: `lanczos3` })
		.png({ compressionLevel: 9 })
		.toFile(resolve(root, `static/og-poster.png`))
}

async function prepareLogo(size: number) {
	const gold = await sharp(resolve(root, `static/logo-gold.png`))
		.ensureAlpha()
		.resize(size, size, {
			fit: `contain`,
			kernel: `lanczos3`,
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		})
		.png()
		.toBuffer()

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
		.toBuffer({ resolveWithObject: true })

	for (let i = 3; i < maskRaw.data.length; i += 4) {
		maskRaw.data[i] = (maskRaw.data[i] ?? 0) < 160 ? 0 : 255
	}

	const mask = await sharp(maskRaw.data, {
		raw: { width: size, height: size, channels: 4 },
	})
		.png()
		.toBuffer()

	return sharp(gold)
		.composite([{ input: mask, blend: `dest-in` }])
		.png()
		.toBuffer()
}
