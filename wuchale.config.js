// @ts-check
import { adapter as svelte } from "@wuchale/svelte"
import { adapter as js } from 'wuchale/adapter-vanilla'
import { defineConfig } from "wuchale"
import { gemini } from "wuchale";
import 'dotenv/config';

export default defineConfig({
    // sourceLocale is en by default
    sourceLocale: 'de',
    otherLocales: ['en'],
    adapters: {
        main: svelte({ loader: 'sveltekit' }),
        js: js({
            loader: 'vite',
            files: [
                'src/**/+{page,layout}.{js,ts}',
                'src/**/+{page,layout}.server.{js,ts}',
            ],
        })
    },
    ai: gemini({
        batchSize: 40,
        parallel: 5,
        think: false,
    }),
})