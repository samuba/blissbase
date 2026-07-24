import { spawn } from "node:child_process"
import { unlink, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const FRAME_POSITION_RATIO = 0.2

/**
 * Extracts a single still frame from a video buffer at 20% of its duration.
 * Temp files are always cleaned up. Returns undefined on failure.
 * @example
 * const frame = await extractVideoFrame({ videoBuffer })
 */
export async function extractVideoFrame(args: { videoBuffer: Buffer }): Promise<Buffer | undefined> {
	const { videoBuffer } = args
	if (!videoBuffer?.byteLength) return undefined

	const videoPath = join(tmpdir(), `blissbase-video-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`)
	const framePath = join(tmpdir(), `blissbase-frame-${Date.now()}-${Math.random().toString(36).slice(2)}.png`)

	try {
		await writeFile(videoPath, videoBuffer)

		const durationSeconds = await probeDurationSeconds({ videoPath })
		const seekSeconds = Math.max(0, (durationSeconds ?? 0) * FRAME_POSITION_RATIO)

		const result = await runCommand({
			cmd: `ffmpeg`,
			argv: [
				`-y`,
				`-ss`,
				String(seekSeconds),
				`-i`,
				videoPath,
				`-frames:v`,
				`1`,
				`-q:v`,
				`2`,
				framePath
			]
		})

		if (result.exitCode !== 0) {
			console.error(`[extractVideoFrame] ffmpeg failed (exit ${result.exitCode}): ${result.stderr.slice(-500)}`)
			return undefined
		}

		const frame = await readFile(framePath)
		if (!frame.byteLength) {
			console.error(`[extractVideoFrame] ffmpeg produced empty frame at ${framePath}`)
			return undefined
		}

		return frame
	} catch (error) {
		console.error(`[extractVideoFrame] Failed to extract frame:`, error)
		return undefined
	} finally {
		await Promise.allSettled([unlink(videoPath), unlink(framePath)])
	}
}

async function probeDurationSeconds(args: { videoPath: string }): Promise<number | undefined> {
	const { videoPath } = args

	try {
		const result = await runCommand({
			cmd: `ffprobe`,
			argv: [
				`-v`,
				`error`,
				`-show_entries`,
				`format=duration`,
				`-of`,
				`default=noprint_wrappers=1:nokey=1`,
				videoPath
			]
		})

		if (result.exitCode !== 0) {
			console.error(`[extractVideoFrame] ffprobe failed (exit ${result.exitCode}): ${result.stderr.slice(-500)}`)
			return undefined
		}

		const duration = Number.parseFloat(result.stdout.trim())
		if (!Number.isFinite(duration) || duration < 0) return undefined
		return duration
	} catch (error) {
		console.error(`[extractVideoFrame] ffprobe error:`, error)
		return undefined
	}
}

function runCommand(args: { cmd: string; argv: string[] }) {
	const { cmd, argv } = args

	return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
		const child = spawn(cmd, argv, { stdio: [`ignore`, `pipe`, `pipe`] })
		const stdoutChunks: Buffer[] = []
		const stderrChunks: Buffer[] = []

		child.stdout.on(`data`, (chunk: Buffer) => stdoutChunks.push(chunk))
		child.stderr.on(`data`, (chunk: Buffer) => stderrChunks.push(chunk))
		child.on(`error`, reject)
		child.on(`close`, (exitCode) => {
			resolve({
				stdout: Buffer.concat(stdoutChunks).toString(`utf8`),
				stderr: Buffer.concat(stderrChunks).toString(`utf8`),
				exitCode: exitCode ?? 1
			})
		})
	})
}
