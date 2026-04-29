// @ts-check
import { adapter as svelte, svelteDefaultHeuristicDerivedReq } from "@wuchale/svelte"
import { adapter as js } from 'wuchale/adapter-vanilla'
import { defineConfig } from "wuchale"
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import 'dotenv/config';

const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY_FOR_LOCALIZATION,
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
        name: "gpt-5.4-nano",
        group: {},
        batchSize: 50,
        parallel: 3,
        translate: async (messages, instruction) => {
            const { text } = await generateText({
                model: openai('gpt-5.4-nano'),
                system: instruction,
                prompt: messages,
                providerOptions: {
                    openai: {
                        reasoningEffort: 'medium',
                    },
                },
            })
            return text
        }
      },
})