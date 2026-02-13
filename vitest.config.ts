import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
        exclude: ['blissbase-telegram-entry', 'node_modules', 'dist', '.idea', '.git', '.cache', 'tests/e2e'],
        env: {
            NODE_ENV: 'test',
            VITEST: 'true',
        },
        setupFiles: ['./src/test/vitest.setup.ts'],
    },
    resolve: {
        alias: {
            '$lib': resolve(__dirname, './src/lib'),
            '$env/static/private': resolve(__dirname, './src/test/mocks/env.ts')
        }
    }
}); 