import { expect, test as base, type APIRequestContext } from "@playwright/test";
import { startWorkerServer } from "./worker-server";

export { expect };

/**
 * Worker-scoped Vite/PGlite server plus a clean DB around every test.
 */
export const test = base.extend<{ resetWorkerDb: void }, { e2eServer: { baseURL: string; port: number } }>({
	e2eServer: [
		async ({}, use, workerInfo) => {
			const server = await startWorkerServer(workerInfo.parallelIndex);
			process.env.E2E_WORKER_INDEX = String(workerInfo.parallelIndex);
			process.env.PLAYWRIGHT_DEV_PORT = String(server.port);
			process.env.PLAYWRIGHT_BASE_URL = server.baseURL;
			await use({ baseURL: server.baseURL, port: server.port });
			await server.stop();
		},
		{ auto: true, scope: `worker`, timeout: 180000 },
	],

	baseURL: async ({ e2eServer }, use) => {
		await use(e2eServer.baseURL);
	},

	resetWorkerDb: [
		async ({ e2eServer, request }, use) => {
			await resetDatabase({ request, baseURL: e2eServer.baseURL });
			await use();
			await resetDatabase({ request, baseURL: e2eServer.baseURL });
		},
		{ auto: true },
	],
});

async function resetDatabase(args: { request: APIRequestContext; baseURL: string }) {
	const response = await args.request.post(`${args.baseURL}/api/test/seed`, { data: { action: `resetDatabase` } });
	if (response.ok()) return;
	throw new Error(`resetDatabase failed: ${await response.text()}`);
}
