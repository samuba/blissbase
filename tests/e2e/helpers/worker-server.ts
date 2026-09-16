import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

const defaultBasePort = 5174;
const portStride = 10;
const startTimeoutMs = 120_000;

/**
 * Starts a Vite+PGlite server isolated to one Playwright worker (port, cache, SvelteKit outDir).
 */
export async function startWorkerServer(workerIndex: number): Promise<E2eServer> {
	const basePort = Number(process.env.PLAYWRIGHT_BASE_PORT) || defaultBasePort;
	const preferredPort = basePort + workerIndex * portStride;
	const port = await findFreePort(preferredPort, portStride);
	const baseURL = `http://127.0.0.1:${port}`;
	const outDir = `.svelte-kit/e2e-w${workerIndex}`;
	const cacheDir = `node_modules/.vite-e2e-w${workerIndex}`;

	const child = spawn(
		bunBin(),
		[`run`, `dev`, `--`, `--host`, `127.0.0.1`, `--port`, String(port), `--strictPort`],
		{
			cwd: process.cwd(),
			detached: true,
			env: {
				...process.env,
				PATH: `${homedir()}/.bun/bin:${process.env.PATH ?? ``}`,
				E2E_TEST: `true`,
				E2E_WORKER_INDEX: String(workerIndex),
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
			stdio: [`ignore`, `pipe`, `pipe`],
		},
	);

	let output = ``;
	const append = (chunk: Buffer) => {
		output += chunk.toString();
		if (process.env.DEBUG_E2E_SERVER === `true`) process.stderr.write(chunk);
	};
	child.stdout?.on(`data`, append);
	child.stderr?.on(`data`, append);

	try {
		await waitForServer({ baseURL, child, timeoutMs: startTimeoutMs });
	} catch (error) {
		await stopProcessTree(child);
		throw new Error(
			`E2E worker ${workerIndex} failed to start on ${baseURL}: ${error instanceof Error ? error.message : error}\n${output.slice(-4000)}`,
		);
	}

	const removeCleanup = installProcessCleanup(child);
	return {
		baseURL,
		port,
		stop: async () => {
			removeCleanup();
			await stopProcessTree(child);
		},
	};
}

function bunBin() {
	if (process.env.BUN_INSTALL) return `${process.env.BUN_INSTALL}/bin/bun`;
	const homeBun = `${homedir()}/.bun/bin/bun`;
	if (existsSync(homeBun)) return homeBun;
	return `bun`;
}

async function findFreePort(preferred: number, stride: number) {
	for (let port = preferred; port < preferred + stride; port++) {
		if (await isPortFree(port)) return port;
	}
	throw new Error(`No free port found in ${preferred}-${preferred + stride - 1}`);
}

function isPortFree(port: number) {
	return new Promise<boolean>((resolve) => {
		const server = createServer();
		server.once(`error`, () => resolve(false));
		server.listen(port, `127.0.0.1`, () => {
			server.close(() => resolve(true));
		});
	});
}

async function waitForServer(args: { baseURL: string; child: ChildProcess; timeoutMs: number }) {
	const { baseURL, child, timeoutMs } = args;
	const startedAt = Date.now();
	const seedUrl = `${baseURL}/api/test/seed`;
	while (Date.now() - startedAt < timeoutMs) {
		if (child.exitCode !== null) throw new Error(`server exited with code ${child.exitCode}`);
		try {
			const response = await fetch(seedUrl, {
				method: `POST`,
				headers: { "content-type": `application/json` },
				body: JSON.stringify({ action: `resetDatabase` }),
				signal: AbortSignal.timeout(5000),
			});
			if (response.ok) return;
		} catch {
			// Server not ready yet.
		}
		await sleep(250);
	}
	throw new Error(`timed out after ${timeoutMs}ms`);
}

function installProcessCleanup(child: ChildProcess) {
	const kill = () => killProcessTreeSync(child);
	const signals = [`exit`, `SIGINT`, `SIGTERM`] as const;
	for (const signal of signals) process.once(signal, kill);
	return () => {
		for (const signal of signals) process.removeListener(signal, kill);
	};
}

function killProcessTreeSync(child: ChildProcess) {
	if (!child.pid || child.exitCode !== null) return;
	try {
		process.kill(-child.pid, `SIGKILL`);
	} catch {
		try {
			child.kill(`SIGKILL`);
		} catch {
			// Already gone.
		}
	}
}

async function stopProcessTree(child: ChildProcess) {
	if (child.pid && child.exitCode === null) {
		try {
			process.kill(-child.pid, `SIGTERM`);
		} catch {
			try {
				child.kill(`SIGTERM`);
			} catch {
				// Already gone.
			}
		}
	}

	const giveUpAt = Date.now() + 5000;
	while (child.exitCode === null && Date.now() < giveUpAt) {
		await sleep(100);
	}

	if (child.pid && child.exitCode === null) {
		killProcessTreeSync(child);
		const forceQuitAt = Date.now() + 2000;
		while (child.exitCode === null && Date.now() < forceQuitAt) {
			await sleep(50);
		}
	}
}

type E2eServer = {
	baseURL: string;
	port: number;
	stop: () => Promise<void>;
};
