import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// `*.live.test.ts` call real AI APIs and only run with TEST_LIVE=1 (`bun run test:live`).
const live = !!process.env.TEST_LIVE;

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: live ? ['**/*.live.test.ts'] : ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
        exclude: ['blissbase-telegram-entry', 'node_modules', 'dist', '.idea', '.git', '.cache', 'tests/e2e', ...(live ? [] : ['**/*.live.test.ts'])],
        env: {
            NODE_ENV: 'test',
            VITEST: 'true',
        },
        setupFiles: ['./src/test/vitest.setup.ts'],
    },
    resolve: {
        alias: {
            '$lib': resolve(__dirname, './src/lib'),
            '$app/server': resolve(__dirname, './src/test/mocks/app-server.ts'),
            '$env/static/private': resolve(__dirname, './src/test/mocks/env.ts')
        }
    }
}); 