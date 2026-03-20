// @ts-check
import { adapter as svelte, svelteDefaultHeuristicDerivedReq } from "@wuchale/svelte"
import { adapter as js } from 'wuchale/adapter-vanilla'
import { defineConfig } from "wuchale"
import { generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import 'dotenv/config';

const google = createGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY_FOR_LOCALIZATION,
});

export default defineConfig({
    // sourceLocale is en by default
    sourceLocale: 'de',
    otherLocales: ['en'],
    locales: ['de', 'en'],
    adapters: {
        main: svelte({ loader: 'sveltekit', heuristic: svelteDefaultHeuristicDerivedReq }),
        js: js({
            loader: 'vite',
            files: [
                'src/**/+{page,layout}.{js,ts}',
                'src/**/+{page,layout}.server.{js,ts}',
                'src/lib/components/tabsNav.ts'
            ],
        })
    },
    ai: {
        name: "gemini-3.1-flash-lite-preview",
        group: {},
        batchSize: 50,
        parallel: 3,
        translate: async (messages, instruction) => {
            const { text } = await generateText({
                model: google('gemini-3-flash-preview'),
                system: instruction,
                prompt: messages,
            })
            return text
        }
      },
})