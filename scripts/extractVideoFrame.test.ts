import { describe, it, expect, beforeAll } from "vitest"
import { spawnSync } from "node:child_process"
import { readdirSync } from "node:fs"
import { readFile, unlink, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { extractVideoFrame } from "./extractVideoFrame"

const hasFfmpeg = (() => {
	try {
		const result = spawnSync(`ffmpeg`, [`-version`], { encoding: `utf8` })
		return result.status === 0
	} catch {
		return false
	}
})()

describe(`extractVideoFrame`, () => {
	let videoBuffer: Buffer | undefined

	beforeAll(async () => {
		if (!hasFfmpeg) return

		const dir = await mkdtemp(join(tmpdir(), `blissbase-extract-frame-test-`))
		const videoPath = join(dir, `sample.mp4`)

		const result = spawnSync(
			`ffmpeg`,
			[
				`-y`,
				`-f`,
				`lavfi`,
				`-i`,
				`color=c=blue:s=320x240:d=5`,
				`-f`,
				`lavfi`,
				`-i`,
				`sine=frequency=440:duration=5`,
				`-shortest`,
				`-c:v`,
				`libx264`,
				`-pix_fmt`,
				`yuv420p`,
				`-c:a`,
				`aac`,
				videoPath
			],
			{ encoding: `utf8` }
		)

		if (result.status !== 0) {
			throw new Error(`Failed to generate synthetic test video: ${result.stderr?.slice(-500)}`)
		}

		videoBuffer = await readFile(videoPath)
		await unlink(videoPath).catch(() => undefined)
	})

	it.skipIf(!hasFfmpeg)(`returns a non-empty image buffer from a video at 20% duration`, async () => {
		expect(videoBuffer?.byteLength).toBeGreaterThan(0)

		const videoTempBefore = listTempFilesWithPrefix(`blissbase-video-`)
		const frameTempBefore = listTempFilesWithPrefix(`blissbase-frame-`)

		const frame = await extractVideoFrame({ videoBuffer: videoBuffer! })

		expect(frame).toBeInstanceOf(Buffer)
		expect(frame!.byteLength).toBeGreaterThan(0)

		// PNG magic bytes
		expect(frame!.subarray(0, 8)).toEqual(
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
		)

		const videoTempAfter = listTempFilesWithPrefix(`blissbase-video-`)
		const frameTempAfter = listTempFilesWithPrefix(`blissbase-frame-`)
		expect(videoTempAfter.filter((name) => !videoTempBefore.includes(name))).toEqual([])
		expect(frameTempAfter.filter((name) => !frameTempBefore.includes(name))).toEqual([])
	})

	it(`returns undefined for an empty buffer`, async () => {
		const frame = await extractVideoFrame({ videoBuffer: Buffer.alloc(0) })
		expect(frame).toBeUndefined()
	})
})

function listTempFilesWithPrefix(prefix: string) {
	return readdirSync(tmpdir()).filter((name) => name.startsWith(prefix))
}
