import { defineConfig } from "vitest/config";
import { resolve } from "path";

// `*.live.test.ts` call real AI APIs and only run with TEST_LIVE=1 (`bun run test:live`).
const live = !!process.env.TEST_LIVE;

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: live ? ["**/*.live.test.ts"] : ["**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
		exclude: [
			"blissbase-telegram-entry",
			"node_modules",
			"dist",
			".idea",
			".git",
			".cache",
			"tests/e2e",
			...(live ? [] : ["**/*.live.test.ts"]),
		],
		env: {
			NODE_ENV: "test",
			VITEST: "true",
		},
		setupFiles: ["./src/test/vitest.setup.ts"],
	},
	resolve: {
		alias: [
			{ find: /^#lib$/, replacement: resolve(__dirname, "./src/lib/index.ts") },
			{ find: /^#lib\/(.*)$/, replacement: resolve(__dirname, "./src/lib/$1") },
			{ find: "$app/server", replacement: resolve(__dirname, "./src/test/mocks/app-server.ts") },
			{ find: "$app/env/private", replacement: resolve(__dirname, "./src/test/mocks/env.ts") },
			{ find: "$app/env/public", replacement: resolve(__dirname, "./src/test/mocks/app-env-public.ts") },
			{ find: "$app/env", replacement: resolve(__dirname, "./src/test/mocks/app-env.ts") },
			{ find: "$env/static/private", replacement: resolve(__dirname, "./src/test/mocks/env.ts") },
		],
	},
});
