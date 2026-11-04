/**
 * One-time (or occasional) sync: local plaintext `.env` → KeePass group `Blissbase`.
 * Never commits secrets. Prompts for the KDBX master password on stdin.
 *
 * Usage: bun run scripts/sync-env-to-keepass.ts
 * Optional: KP_DB_PATH=/path/to.kdbx bun run scripts/sync-env-to-keepass.ts
 */
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { resolve } from "node:path"
import { spawnSync } from "node:child_process"
import * as readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"

const GROUP = `Blissbase`
const defaultDb = resolve(homedir(), `Dropbox/pws/blissbase.kdbx`)
const dbPath = process.env.KP_DB_PATH || defaultDb
const envPath = resolve(process.cwd(), `.env`)

if (!existsSync(dbPath)) {
	console.error(`KeePass DB not found: ${dbPath}`)
	process.exit(1)
}
if (!existsSync(envPath)) {
	console.error(`No .env at ${envPath} — nothing to import`)
	process.exit(1)
}

const entries = parseEnvFile(envPath)
const skip = new Set([`KP_PASSWORD`, `KP_DB_PATH`])
const toSync = [...entries.entries()].filter(([k]) => !skip.has(k) && entries.get(k) !== ``)

console.log(`DB: ${dbPath}`)
console.log(`Will upsert ${toSync.length} entries under group "${GROUP}" (Password field = value)`)

const rl = readline.createInterface({ input, output })
const password = await rl.question(`KeePass master password: `)
rl.close()
if (!password) {
	console.error(`Password required`)
	process.exit(1)
}

ensureGroup({ dbPath, password, group: GROUP })

let ok = 0
let fail = 0
for (const [key, value] of toSync) {
	const path = `${GROUP}/${key}`
	try {
		upsertEntry({ dbPath, password, path, value })
		ok++
		console.log(`✓ ${path}`)
	} catch (e) {
		fail++
		console.error(`✗ ${path}: ${e instanceof Error ? e.message : e}`)
	}
}

console.log(`Done. ok=${ok} fail=${fail}`)
console.log(`Next: gitignored .env.local with KP_PASSWORD=… and VAR=kp("Blissbase/VAR") per secret`)
console.log(`Then: bun run env:load`)
if (fail === 0) {
	console.log(`After verifying, delete plaintext .env — KeePass becomes source of truth.`)
}

function parseEnvFile(path: string) {
	const map = new Map<string, string>()
	for (const raw of readFileSync(path, `utf8`).split(/\r?\n/)) {
		const line = raw.trim()
		if (!line || line.startsWith(`#`) || !line.includes(`=`)) continue
		const i = line.indexOf(`=`)
		const key = line.slice(0, i).trim()
		let value = line.slice(i + 1)
		if (
			(value.startsWith(`"`) && value.endsWith(`"`)) ||
			(value.startsWith(`'`) && value.endsWith(`'`))
		) {
			value = value.slice(1, -1)
		}
		if (!key) continue
		map.set(key, value)
	}
	return map
}

function ensureGroup({ dbPath, password, group }: { dbPath: string; password: string; group: string }) {
	const ls = keepassxc([`ls`, `-R`, dbPath], password)
	if (ls.status === 0 && ls.stdout.includes(`${group}/`)) return
	const mkdir = keepassxc([`mkdir`, dbPath, group], password)
	if (mkdir.status !== 0 && !`${mkdir.stderr}${mkdir.stdout}`.toLowerCase().includes(`already`)) {
		throw new Error(`mkdir ${group} failed: ${mkdir.stderr || mkdir.stdout}`)
	}
}

function upsertEntry({
	dbPath,
	password,
	path,
	value,
}: {
	dbPath: string
	password: string
	path: string
	value: string
}) {
	const show = keepassxc([`show`, `-s`, dbPath, path], password)
	if (show.status === 0) {
		const edited = keepassxc([`edit`, `-p`, dbPath, path], `${password}\n${value}\n`)
		if (edited.status !== 0) throw new Error(edited.stderr || edited.stdout || `edit failed`)
		return
	}
	const added = keepassxc([`add`, `-p`, dbPath, path], `${password}\n${value}\n`)
	if (added.status !== 0) throw new Error(added.stderr || added.stdout || `add failed`)
}

function keepassxc(args: string[], stdin: string) {
	return spawnSync(`keepassxc-cli`, args, {
		input: stdin.endsWith(`\n`) ? stdin : `${stdin}\n`,
		encoding: `utf8`,
	})
}
