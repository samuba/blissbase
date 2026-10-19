#!/usr/bin/env bun
/**
 * Verification harness for Blissbase.
 * Launch an isolated Vite+PGlite instance, doctor it, drive the UI via Playwright
 * data-testid handles, capture evidence, and tear down only what this run started.
 *
 * Invocation (from repo root):
 *   bun .cursor/skills/verify-blissbase/scripts/control-blissbase.ts <command> ...
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium, type Browser, type Page } from "@playwright/test";

const repoRoot = resolve(import.meta.dir, `../../../..`);
const skillRoot = resolve(import.meta.dir, `..`);
const defaultArtifactsRoot = join(skillRoot, `artifacts`);
const defaultBasePort = 5190;
const startTimeoutMs = 120_000;

const args = process.argv.slice(2);
const command = args[0];

if (!command) {
	printHelp();
	process.exit(1);
}

try {
	await dispatch(command, args.slice(1));
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}

async function dispatch(cmd: string, rest: string[]) {
	switch (cmd) {
		case `launch`:
			return launch(parseFlags(rest));
		case `doctor`:
			return doctor(parseFlags(rest));
		case `seed`:
			return seed(rest[0], parseFlags(rest.slice(1)));
		case `browser`:
			return browser(rest[0], parseFlags(rest.slice(1)));
		case `browser-daemon`:
			return browserDaemon(parseFlags(rest));
		case `status`:
			return status(parseFlags(rest));
		case `cleanup`:
			return cleanup(parseFlags(rest));
		case `help`:
		case `--help`:
		case `-h`:
			printHelp();
			return;
		default:
			throw new Error(`Unknown command: ${cmd}. Run with help.`);
	}
}

function printHelp() {
	console.log(`control-blissbase — Blissbase verification harness

Usage (from repo root):
  bun .cursor/skills/verify-blissbase/scripts/control-blissbase.ts <command> [flags]

Commands:
  launch [--run-id ID] [--port N]   Start isolated Vite+PGlite; write state under /tmp
  doctor [--run-id ID]              Read-only health check (process, seed API, homepage)
  seed <target> [--run-id ID]       reset | baseline | meditation | yoga | online
  browser <action> [flags]          Drive the live UI (persistent browser session)
  status [--run-id ID]              Print current instance state JSON
  cleanup [--run-id ID]             Stop server + browser; keep artifacts/

Browser actions:
  start                             Start a persistent Chromium (auto on first action)
  stop                              Stop the persistent Chromium only
  goto --path /                     Navigate (retries Vite compile 500s)
  wait --testid NAME                Wait for element
  click --testid NAME [--text TEXT]
  click --role ROLE --name NAME     Click by accessible role + name (when no testid)
  fill --testid NAME --value TEXT
  press --key KEY                   e.g. Enter, Escape
  expect-visible --testid NAME [--text TEXT] [--timeout MS]
  expect-visible --role ROLE --name NAME
  expect-count --testid NAME --count N [--text TEXT]
  screenshot --path REL_OR_ABS
  snapshot --path REL_OR_ABS        Accessibility tree dump
  sign-in [--user-id UUID] [--email ADDR]
  hydrate                           Wait for data-app-hydrated=true

Flags:
  --run-id ID     Defaults to $BLISSBASE_VERIFY_RUN_ID or active run in skill dir
  --port N        Preferred port (default 5190); picks next free in stride
  --path PATH     URL path for goto
  --testid NAME   data-testid selector
  --role ROLE     ARIA role for role+name locate
  --name NAME     Accessible name (exact) for role+name locate
  --value TEXT    Fill value
  --text TEXT     Filter by visible text
  --key KEY       Keyboard key
  --count N       Expected element count
  --timeout MS    Expectation timeout (default 15000)
  --first         Act on the first match
  --user-id UUID  E2E auth cookie user id
  --email ADDR    E2E auth cookie email

Env:
  BLISSBASE_VERIFY_RUN_ID   Active run id
  BLISSBASE_VERIFY_DIR      Override instance dir (default /tmp/blissbase-verify-$RUN_ID)
`);
}

async function launch(flags: Flags) {
	const runId = resolveRunId(flags, { create: true });
	const instanceDir = instanceDirFor(runId);
	mkdirSync(instanceDir, { recursive: true });
	mkdirSync(defaultArtifactsRoot, { recursive: true });

	const existing = readState(runId);
	if (existing && isPidAlive(existing.pid)) {
		throw new Error(`Run ${runId} already has a live server on ${existing.baseURL} (pid ${existing.pid}). cleanup first.`);
	}

	const preferredPort = Number(flags.port) || Number(process.env.BLISSBASE_VERIFY_PORT) || defaultBasePort;
	const port = await findFreePort(preferredPort, 20);
	const baseURL = `http://127.0.0.1:${port}`;
	const workerIndex = `verify-${runId}`;
	const outDir = join(repoRoot, `.svelte-kit`, `verify-${runId}`);
	const cacheDir = join(repoRoot, `node_modules`, `.vite-verify-${runId}`);

	const logPath = join(instanceDir, `server.log`);
	const logFd = openSync(logPath, `w`);
	const child = spawn(
		bunBin(),
		[`run`, `dev`, `--`, `--host`, `127.0.0.1`, `--port`, String(port), `--strictPort`],
		{
			cwd: repoRoot,
			detached: true,
			env: {
				...process.env,
				PATH: `${homedir()}/.bun/bin:${process.env.PATH ?? ``}`,
				E2E_TEST: `true`,
				E2E_WORKER_INDEX: `0`,
				PLAYWRIGHT_DEV_PORT: String(port),
				PLAYWRIGHT_BASE_URL: baseURL,
				SVELTEKIT_OUTDIR: outDir,
				VITE_CACHE_DIR: cacheDir,
				GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY || `test-api-key`,
				PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY: process.env.PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY || `test-browser-api-key`,
				PUBLIC_SUPABASE_URL: process.env.PUBLIC_SUPABASE_URL || `http://localhost:54321`,
				PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || `test-key`,
				PUBLIC_ADMIN_USER_ID: process.env.PUBLIC_ADMIN_USER_ID || `test-admin`,
				TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || `test-token`,
				S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID || `test-s3-key`,
				S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY || `test-s3-secret`,
				S3_BUCKET_NAME: process.env.S3_BUCKET_NAME || `test-bucket`,
				CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || `test-account`,
				ADMIN_EMAILS: process.env.ADMIN_EMAILS || `test@admin.de`,
			},
			// Redirect to a file so this CLI can exit without holding open pipes.
			stdio: [`ignore`, logFd, logFd],
		},
	);

	if (!child.pid) {
		throw new Error(`Failed to spawn Vite (no pid)`);
	}

	try {
		const readyDeadline = Date.now() + startTimeoutMs;
		await waitForSeedApi({ baseURL, child, timeoutMs: startTimeoutMs });
		await warmupApp({
			baseURL,
			child,
			timeoutMs: Math.max(readyDeadline - Date.now(), 30_000),
		});
	} catch (error) {
		await stopProcessTree(child);
		const logTail = existsSync(logPath) ? readFileSync(logPath, `utf8`).slice(-4000) : ``;
		throw new Error(
			`Launch failed on ${baseURL}: ${error instanceof Error ? error.message : error}\n${logTail}`,
		);
	}

	const state: InstanceState = {
		runId,
		pid: child.pid,
		port,
		baseURL,
		outDir,
		cacheDir,
		instanceDir,
		artifactsRoot: defaultArtifactsRoot,
		startedAt: new Date().toISOString(),
		workerIndex,
		revision: gitRevision(),
	};
	writeState(state);
	writeFileSync(join(skillRoot, `.active-run`), runId);
	// Detach so this CLI can exit while the server keeps running.
	child.unref();

	console.log(JSON.stringify({ ok: true, ...state }, null, 2));
}

async function doctor(flags: Flags) {
	const state = requireLiveState(flags);
	const checks: Record<string, unknown> = {
		runId: state.runId,
		pid: state.pid,
		pidAlive: isPidAlive(state.pid),
		baseURL: state.baseURL,
		revision: state.revision,
		artifactsRoot: state.artifactsRoot,
	};

	if (!isPidAlive(state.pid)) {
		console.log(JSON.stringify({ ok: false, reason: `process dead`, checks }, null, 2));
		process.exit(2);
	}

	const seedProbe = await fetch(`${state.baseURL}/api/test/seed`, {
		method: `POST`,
		headers: { "content-type": `application/json` },
		body: JSON.stringify({ action: `getEventById`, data: { id: 0 } }),
		signal: AbortSignal.timeout(10000),
	});
	checks.seedApiStatus = seedProbe.status;
	checks.seedApiOk = seedProbe.ok;
	if (!seedProbe.ok) {
		console.log(JSON.stringify({ ok: false, reason: `seed API unhealthy`, checks, body: await seedProbe.text() }, null, 2));
		process.exit(2);
	}

	const home = await fetch(state.baseURL, { signal: AbortSignal.timeout(15000) });
	checks.homepageStatus = home.status;
	checks.homepageOk = home.status > 0 && home.status < 500;
	if (!checks.homepageOk) {
		console.log(JSON.stringify({ ok: false, reason: `homepage not usable`, checks }, null, 2));
		process.exit(2);
	}

	const ownedPort = await portOwnedByOurTree(state.port, state.pid);
	checks.portOwnedByUs = ownedPort;
	if (!ownedPort) {
		console.log(JSON.stringify({ ok: false, reason: `port ${state.port} not owned by pid ${state.pid} or its children`, checks }, null, 2));
		process.exit(2);
	}

	console.log(JSON.stringify({ ok: true, checks }, null, 2));
}

async function seed(target: string | undefined, flags: Flags) {
	if (!target) throw new Error(`seed requires a target: reset | baseline | meditation | yoga | online`);
	const state = requireLiveState(flags);

	if (target === `reset`) {
		await seedAction(state.baseURL, `resetDatabase`);
		console.log(JSON.stringify({ ok: true, action: `resetDatabase` }));
		return;
	}

	const factories: Record<string, () => Record<string, unknown>> = {
		meditation: () => ({
			name: `Meditation Workshop`,
			description: `A peaceful meditation session`,
			startAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
			address: [`Zen Center`, `Berlin`],
			price: `Free`,
			host: `Tribehaus Studio`,
			tags: [`Meditation`, `Wellness`],
			source: `tribehaus`,
			sourceUrl: `https://tribehaus.org/meditation-workshop`,
			slug: `verify-meditation-${Date.now()}`,
		}),
		yoga: () => ({
			name: `Yoga Flow Class`,
			description: `Morning yoga flow for all levels`,
			startAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
			address: [`Yoga Studio`, `Munich`],
			price: `€15`,
			host: `Heilnetz München`,
			tags: [`Yoga`, `Fitness`],
			source: `heilnetz`,
			sourceUrl: `https://heilnetz.de/yoga-flow`,
			slug: `verify-yoga-${Date.now()}`,
		}),
		online: () => ({
			name: `Online Breathwork Session`,
			description: `Virtual breathwork class via Zoom`,
			startAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
			address: [],
			price: `€10`,
			host: `Tribehaus Community`,
			tags: [`Breathwork`, `Online`],
			attendanceMode: `online`,
			source: `tribehaus`,
			sourceUrl: `https://tribehaus.com/breathwork`,
			slug: `verify-online-${Date.now()}`,
		}),
	};

	if (target === `baseline`) {
		await seedAction(state.baseURL, `resetDatabase`);
		const created = [];
		for (const key of [`meditation`, `yoga`, `online`] as const) {
			const event = await seedAction(state.baseURL, `createEvent`, factories[key]());
			created.push(event);
		}
		console.log(JSON.stringify({ ok: true, action: `baseline`, created }, null, 2));
		return;
	}

	const factory = factories[target];
	if (!factory) throw new Error(`Unknown seed target: ${target}`);
	const event = await seedAction(state.baseURL, `createEvent`, factory());
	console.log(JSON.stringify({ ok: true, action: `createEvent`, target, event }, null, 2));
}

async function browser(action: string | undefined, flags: Flags) {
	if (!action) throw new Error(`browser requires an action (start|stop|goto|click|fill|...)`);
	const state = requireLiveState(flags);

	if (action === `start`) {
		const meta = await ensureBrowserDaemon(state);
		console.log(JSON.stringify({ ok: true, action: `start`, commandUrl: meta.commandUrl }));
		return;
	}
	if (action === `stop`) {
		await stopBrowserDaemon(state);
		console.log(JSON.stringify({ ok: true, action: `stop` }));
		return;
	}

	await ensureBrowserDaemon(state);
	const result = await browserRpc(state, { action, flags });
	if (!result.ok) throw new Error(result.error || `browser ${action} failed`);
	console.log(JSON.stringify(result));
}

async function browserDaemon(flags: Flags) {
	const state = requireLiveState(flags);
	const browserInstance = await chromium.launch({ headless: true });
	const context = await browserInstance.newContext({
		baseURL: state.baseURL,
		locale: `de-DE`,
		extraHTTPHeaders: { "Accept-Language": `de` },
	});
	const page = await context.newPage();
	installGotoRetries(page);

	const commandServer = Bun.serve({
		hostname: `127.0.0.1`,
		port: 0,
		async fetch(req) {
			if (req.method !== `POST`) return new Response(`method not allowed`, { status: 405 });
			try {
				const body = (await req.json()) as { action: string; flags: Flags };
				const result = await runBrowserAction({ action: body.action, flags: body.flags, page, context, state });
				return Response.json(result);
			} catch (error) {
				return Response.json(
					{ ok: false, error: error instanceof Error ? error.message : String(error) },
					{ status: 500 },
				);
			}
		},
	});

	const meta: BrowserMeta = {
		commandUrl: `http://127.0.0.1:${commandServer.port}`,
		pid: process.pid,
		startedAt: new Date().toISOString(),
	};
	writeFileSync(browserMetaPath(state), JSON.stringify(meta, null, 2));
	writeFileSync(join(state.instanceDir, `browser-daemon.ready`), `1`);

	const shutdown = async () => {
		try {
			commandServer.stop(true);
		} catch {
			// already stopped
		}
		try {
			await context.close();
		} catch {
			// already closed
		}
		try {
			await browserInstance.close();
		} catch {
			// already closed
		}
		process.exit(0);
	};
	process.on(`SIGTERM`, () => void shutdown());
	process.on(`SIGINT`, () => void shutdown());
	await new Promise(() => {});
}

async function runBrowserAction(args: {
	action: string;
	flags: Flags;
	page: Page;
	context: Awaited<ReturnType<Browser[`newContext`]>>;
	state: InstanceState;
}) {
	const { action, flags, page, context, state } = args;
	switch (action) {
		case `goto`: {
			const path = flags.path ?? `/`;
			await page.goto(path, { waitUntil: `domcontentloaded` });
			break;
		}
		case `hydrate`: {
			await page.waitForFunction(
				() => document.documentElement.getAttribute(`data-app-hydrated`) === `true`,
				undefined,
				{ timeout: Number(flags.timeout) || 15000 },
			);
			break;
		}
		case `wait`: {
			const testid = requireFlag(flags, `testid`);
			await page.getByTestId(testid).first().waitFor({ timeout: Number(flags.timeout) || 15000 });
			break;
		}
		case `click`: {
			await locate(page, flags).click();
			break;
		}
		case `fill`: {
			await locate(page, flags).fill(requireFlag(flags, `value`));
			break;
		}
		case `press`: {
			await page.keyboard.press(requireFlag(flags, `key`));
			break;
		}
		case `expect-visible`: {
			await locate(page, flags).waitFor({ state: `visible`, timeout: Number(flags.timeout) || 15000 });
			break;
		}
		case `expect-text`: {
			const expected = requireFlag(flags, `text`);
			const locator = locate(page, flags);
			const timeout = Number(flags.timeout) || 15000;
			await locator.waitFor({ state: `visible`, timeout });
			const started = Date.now();
			let actual = ``;
			while (Date.now() - started < timeout) {
				actual = (await locator.innerText()).replace(/\s+/g, ` `).trim();
				if (actual.includes(expected)) break;
				await sleep(200);
			}
			if (!actual.includes(expected)) {
				throw new Error(`Expected text including ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
			}
			break;
		}
		case `expect-count`: {
			const testid = requireFlag(flags, `testid`);
			const expected = Number(requireFlag(flags, `count`));
			let locator = page.getByTestId(testid);
			if (flags.text) locator = locator.filter({ hasText: flags.text });
			const timeout = Number(flags.timeout) || 15000;
			const started = Date.now();
			while (Date.now() - started < timeout) {
				if ((await locator.count()) === expected) break;
				await sleep(200);
			}
			const finalCount = await locator.count();
			if (finalCount !== expected) {
				throw new Error(`Expected ${expected} matches for ${testid}, got ${finalCount}`);
			}
			break;
		}
		case `screenshot`: {
			const out = resolveArtifactPath(state, requireFlag(flags, `path`));
			mkdirSync(dirname(out), { recursive: true });
			await page.screenshot({ path: out, fullPage: true });
			return { ok: true, path: out, url: page.url() };
		}
		case `snapshot`: {
			const out = resolveArtifactPath(state, requireFlag(flags, `path`));
			mkdirSync(dirname(out), { recursive: true });
			const snapshot = await page.locator(`html`).ariaSnapshot();
			writeFileSync(
				out,
				[
					`# Blissbase ARIA snapshot`,
					`# runId: ${state.runId}`,
					`# url: ${page.url()}`,
					`# capturedAt: ${new Date().toISOString()}`,
					``,
					snapshot,
				].join(`\n`),
			);
			return { ok: true, path: out, url: page.url() };
		}
		case `sign-in`: {
			const domain = new URL(state.baseURL).hostname;
			await context.addCookies([
				{
					name: `e2e_user_id`,
					value: flags[`user-id`] ?? `00000000-0000-4000-8000-000000000001`,
					domain,
					path: `/`,
				},
				{
					name: `e2e_user_email`,
					value: flags.email ?? `e2e-user@example.com`,
					domain,
					path: `/`,
				},
			]);
			break;
		}
		default:
			throw new Error(`Unknown browser action: ${action}`);
	}
	return { ok: true, action, url: page.url() };
}

async function browserRpc(state: InstanceState, body: { action: string; flags: Flags }) {
	const meta = readBrowserMeta(state);
	if (!meta?.commandUrl) throw new Error(`browser daemon not ready`);
	const response = await fetch(meta.commandUrl, {
		method: `POST`,
		headers: { "content-type": `application/json` },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(120000),
	});
	return (await response.json()) as { ok: boolean; error?: string; path?: string; url?: string; action?: string };
}

async function ensureBrowserDaemon(state: InstanceState) {
	const existing = readBrowserMeta(state);
	if (existing?.commandUrl && existing.pid && isPidAlive(existing.pid)) {
		try {
			const probe = await fetch(existing.commandUrl, {
				method: `POST`,
				headers: { "content-type": `application/json` },
				body: JSON.stringify({ action: `hydrate`, flags: { timeout: `1000` } }),
				signal: AbortSignal.timeout(2000),
			});
			// Any HTTP response means the daemon is up (hydrate may fail if blank).
			if (probe.status > 0) return existing;
		} catch {
			// stale; restart below
		}
	}

	rmSync(join(state.instanceDir, `browser-daemon.ready`), { force: true });
	rmSync(browserMetaPath(state), { force: true });
	const logFd = openSync(join(state.instanceDir, `browser-daemon.log`), `w`);
	const child = spawn(
		bunBin(),
		[join(skillRoot, `scripts`, `control-blissbase.ts`), `browser-daemon`, `--run-id`, state.runId],
		{
			cwd: repoRoot,
			detached: true,
			stdio: [`ignore`, logFd, logFd],
			env: {
				...process.env,
				PATH: `${homedir()}/.bun/bin:${process.env.PATH ?? ``}`,
				BLISSBASE_VERIFY_RUN_ID: state.runId,
			},
		},
	);
	if (!child.pid) throw new Error(`Failed to start browser daemon`);
	child.unref();

	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		if (existsSync(join(state.instanceDir, `browser-daemon.ready`))) {
			const meta = readBrowserMeta(state);
			if (meta?.commandUrl) return meta;
		}
		if (!isPidAlive(child.pid)) {
			const logTail = existsSync(join(state.instanceDir, `browser-daemon.log`))
				? readFileSync(join(state.instanceDir, `browser-daemon.log`), `utf8`).slice(-2000)
				: ``;
			throw new Error(`browser daemon exited early\n${logTail}`);
		}
		await sleep(100);
	}
	throw new Error(`browser daemon failed to become ready`);
}

async function stopBrowserDaemon(state: InstanceState) {
	const meta = readBrowserMeta(state);
	if (meta?.pid && isPidAlive(meta.pid)) {
		try {
			process.kill(meta.pid, `SIGTERM`);
		} catch {
			// gone
		}
		const giveUp = Date.now() + 5000;
		while (isPidAlive(meta.pid) && Date.now() < giveUp) await sleep(100);
		if (isPidAlive(meta.pid)) {
			try {
				process.kill(meta.pid, `SIGKILL`);
			} catch {
				// gone
			}
		}
	}
	rmSync(browserMetaPath(state), { force: true });
	rmSync(join(state.instanceDir, `browser-daemon.ready`), { force: true });
}

function browserMetaPath(state: InstanceState) {
	return join(state.instanceDir, `browser.json`);
}

function readBrowserMeta(state: InstanceState): BrowserMeta | null {
	const path = browserMetaPath(state);
	if (!existsSync(path)) return null;
	return JSON.parse(readFileSync(path, `utf8`)) as BrowserMeta;
}

async function status(flags: Flags) {
	const runId = resolveRunId(flags, { create: false });
	const state = readState(runId);
	if (!state) {
		console.log(JSON.stringify({ ok: false, reason: `no state for run ${runId}` }));
		process.exit(2);
	}
	console.log(JSON.stringify({ ok: true, alive: isPidAlive(state.pid), state }, null, 2));
}

async function cleanup(flags: Flags) {
	const runId = resolveRunId(flags, { create: false });
	const state = readState(runId);
	if (!state) {
		console.log(JSON.stringify({ ok: true, skipped: true, reason: `no state for ${runId}` }));
		return;
	}

	await stopBrowserDaemon(state);

	if (isPidAlive(state.pid)) {
		try {
			process.kill(-state.pid, `SIGTERM`);
		} catch {
			try {
				process.kill(state.pid, `SIGTERM`);
			} catch {
				// already gone
			}
		}
		const giveUp = Date.now() + 5000;
		while (isPidAlive(state.pid) && Date.now() < giveUp) await sleep(100);
		if (isPidAlive(state.pid)) {
			try {
				process.kill(-state.pid, `SIGKILL`);
			} catch {
				try {
					process.kill(state.pid, `SIGKILL`);
				} catch {
					// already gone
				}
			}
		}
	}

	// Scratch only — never delete artifactsRoot
	rmSync(join(state.instanceDir, `storage.json`), { force: true });
	const activePath = join(skillRoot, `.active-run`);
	if (existsSync(activePath) && readFileSync(activePath, `utf8`).trim() === runId) {
		rmSync(activePath, { force: true });
	}
	writeFileSync(join(state.instanceDir, `cleaned-at`), new Date().toISOString());

	console.log(
		JSON.stringify(
			{
				ok: true,
				runId,
				stoppedPid: state.pid,
				artifactsRoot: state.artifactsRoot,
				note: `Evidence under artifacts/ was retained`,
			},
			null,
			2,
		),
	);
}

function locate(page: Page, flags: Flags) {
	if (flags.role && flags.name) {
		let locator = page.getByRole(flags.role as Parameters<Page[`getByRole`]>[0], {
			name: flags.name,
			exact: flags.exact !== `false`,
		});
		if (flags.text) locator = locator.filter({ hasText: flags.text });
		return locator.first();
	}
	const testid = requireFlag(flags, `testid`);
	// Skip [inert] so CreateCta's inline control (inert while FAB shows) does not steal clicks.
	let locator = page.getByTestId(testid).and(page.locator(`:not([inert])`));
	if (flags.text) locator = locator.filter({ hasText: flags.text });
	return locator.first();
}

function resolveArtifactPath(state: InstanceState, path: string) {
	if (isAbsolute(path)) return path;
	return join(state.artifactsRoot, path);
}

function storagePath(state: InstanceState) {
	return join(state.instanceDir, `storage.json`);
}

async function seedAction(baseURL: string, action: string, data?: unknown) {
	const response = await fetch(`${baseURL}/api/test/seed`, {
		method: `POST`,
		headers: { "content-type": `application/json` },
		body: JSON.stringify({ action, data }),
		signal: AbortSignal.timeout(30000),
	});
	if (!response.ok) {
		throw new Error(`Seed ${action} failed: ${await response.text()}`);
	}
	return response.json();
}

function requireLiveState(flags: Flags) {
	const runId = resolveRunId(flags, { create: false });
	const state = readState(runId);
	if (!state) throw new Error(`No instance state for run ${runId}. Run launch first.`);
	if (!isPidAlive(state.pid)) throw new Error(`Instance pid ${state.pid} is dead. Relaunch with launch.`);
	return state;
}

function resolveRunId(flags: Flags, args: { create: boolean }) {
	if (flags[`run-id`]) return flags[`run-id`];
	if (process.env.BLISSBASE_VERIFY_RUN_ID) return process.env.BLISSBASE_VERIFY_RUN_ID;
	const activePath = join(skillRoot, `.active-run`);
	if (existsSync(activePath)) return readFileSync(activePath, `utf8`).trim();
	if (args.create) {
		const stamp = new Date().toISOString().replace(/[:.]/g, `-`);
		const suffix = createHash(`sha1`).update(`${stamp}-${Math.random()}`).digest(`hex`).slice(0, 6);
		return `${stamp}-${suffix}`;
	}
	throw new Error(`No run id. Pass --run-id, set BLISSBASE_VERIFY_RUN_ID, or launch first.`);
}

function instanceDirFor(runId: string) {
	if (process.env.BLISSBASE_VERIFY_DIR) return process.env.BLISSBASE_VERIFY_DIR;
	return join(`/tmp`, `blissbase-verify-${runId}`);
}

function statePath(runId: string) {
	return join(instanceDirFor(runId), `state.json`);
}

function readState(runId: string): InstanceState | null {
	const path = statePath(runId);
	if (!existsSync(path)) return null;
	return JSON.parse(readFileSync(path, `utf8`)) as InstanceState;
}

function writeState(state: InstanceState) {
	mkdirSync(state.instanceDir, { recursive: true });
	writeFileSync(statePath(state.runId), JSON.stringify(state, null, 2));
}

function parseFlags(argv: string[]) {
	const flags: Flags = {};
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (!token.startsWith(`--`)) continue;
		const key = token.slice(2);
		const next = argv[i + 1];
		if (!next || next.startsWith(`--`)) {
			flags[key] = `true`;
			continue;
		}
		flags[key] = next;
		i++;
	}
	return flags;
}

function requireFlag(flags: Flags, key: string) {
	const value = flags[key];
	if (!value) throw new Error(`Missing --${key}`);
	return value;
}

function bunBin() {
	if (process.env.BUN_INSTALL) return `${process.env.BUN_INSTALL}/bin/bun`;
	const homeBun = `${homedir()}/.bun/bin/bun`;
	if (existsSync(homeBun)) return homeBun;
	return `bun`;
}

function isPidAlive(pid: number) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function portOwnedByOurTree(port: number, rootPid: number) {
	const tree = collectDescendantPids(rootPid);
	tree.add(rootPid);

	// Prefer ss when present (shows the listening pid).
	try {
		const proc = Bun.spawn([`bash`, `-lc`, `command -v ss >/dev/null && ss -ltnp 2>/dev/null | grep -E ':${port}\\b' || true`], {
			stdout: `pipe`,
			stderr: `pipe`,
		});
		const text = await new Response(proc.stdout).text();
		await proc.exited;
		if (text.trim()) {
			for (const pid of tree) {
				if (text.includes(`pid=${pid}`) || text.includes(`,${pid},`)) return true;
			}
			return false;
		}
	} catch {
		// fall through
	}

	// No ss (common in slim images): accept if our tree is alive and the port answers.
	if (![...tree].some(isPidAlive)) return false;
	try {
		const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(5000) });
		return response.status > 0;
	} catch {
		return false;
	}
}

function collectDescendantPids(rootPid: number) {
	const pids = new Set<number>();
	const queue = [rootPid];
	while (queue.length) {
		const parent = queue.pop()!;
		try {
			const children = Bun.spawnSync([`bash`, `-lc`, `ps -o pid= --ppid ${parent}`]);
			for (const line of children.stdout.toString().split(`\n`)) {
				const child = Number(line.trim());
				if (!child || pids.has(child)) continue;
				pids.add(child);
				queue.push(child);
			}
		} catch {
			// ignore
		}
	}
	return pids;
}

async function findFreePort(preferred: number, stride: number) {
	for (let port = preferred; port < preferred + stride; port++) {
		if (await isPortFree(port)) return port;
	}
	throw new Error(`No free port in ${preferred}-${preferred + stride - 1}`);
}

function isPortFree(port: number) {
	return new Promise<boolean>((resolvePromise) => {
		const server = createServer();
		server.once(`error`, () => resolvePromise(false));
		server.listen(port, `127.0.0.1`, () => {
			server.close(() => resolvePromise(true));
		});
	});
}

async function waitForSeedApi(args: { baseURL: string; child: ChildProcess; timeoutMs: number }) {
	const { baseURL, child, timeoutMs } = args;
	const startedAt = Date.now();
	const seedUrl = `${baseURL}/api/test/seed`;
	while (Date.now() - startedAt < timeoutMs) {
		if (child.exitCode !== null) throw new Error(`server exited with code ${child.exitCode}`);
		try {
			const response = await fetch(seedUrl, {
				method: `POST`,
				headers: { "content-type": `application/json` },
				body: JSON.stringify({ action: `getEventById`, data: { id: 0 } }),
				signal: AbortSignal.timeout(5000),
			});
			if (response.ok) return;
		} catch {
			// not ready
		}
		await sleep(250);
	}
	throw new Error(`timed out after ${timeoutMs}ms waiting for seed API`);
}

async function warmupApp(args: { baseURL: string; child: ChildProcess; timeoutMs: number }) {
	const paths = [`/`, `/offerings`, `/events/new`, `/offerings/new`];
	const { baseURL, child, timeoutMs } = args;
	const deadline = Date.now() + timeoutMs;
	for (const path of paths) {
		while (true) {
			if (child.exitCode !== null) throw new Error(`server exited with code ${child.exitCode}`);
			if (Date.now() >= deadline) throw new Error(`warmup ${path} timed out`);
			try {
				const response = await fetch(`${baseURL}${path}`, { signal: AbortSignal.timeout(10000) });
				if (response.status < 500) break;
			} catch {
				// compile race
			}
			await sleep(250);
		}
	}
}

async function stopProcessTree(child: ChildProcess) {
	if (child.pid && child.exitCode === null) {
		try {
			process.kill(-child.pid, `SIGKILL`);
		} catch {
			try {
				child.kill(`SIGKILL`);
			} catch {
				// gone
			}
		}
	}
}

function installGotoRetries(page: Page) {
	const originalGoto = page.goto.bind(page);
	page.goto = async (url, options) => {
		let lastResponse: Awaited<ReturnType<typeof originalGoto>> = null;
		for (let attempt = 0; attempt < 8; attempt++) {
			try {
				lastResponse = await originalGoto(url, options);
			} catch (error) {
				if (attempt === 7) throw error;
				await sleep(200 * (attempt + 1));
				continue;
			}
			const status = lastResponse?.status() ?? 0;
			if (status > 0 && status < 500) return lastResponse;
			if (attempt === 7) return lastResponse;
			await sleep(200 * (attempt + 1));
		}
		return lastResponse;
	};
}

function gitRevision() {
	try {
		const proc = Bun.spawnSync([`git`, `-C`, repoRoot, `rev-parse`, `--short`, `HEAD`]);
		return proc.stdout.toString().trim() || `unknown`;
	} catch {
		return `unknown`;
	}
}

type Flags = Record<string, string | undefined>;

type InstanceState = {
	runId: string;
	pid: number;
	port: number;
	baseURL: string;
	outDir: string;
	cacheDir: string;
	instanceDir: string;
	artifactsRoot: string;
	startedAt: string;
	workerIndex: string;
	revision: string;
};

type BrowserMeta = {
	commandUrl: string;
	pid: number;
	startedAt: string;
};
