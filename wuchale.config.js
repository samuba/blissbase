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
    // first locale is the source locale
    locales: ['de', 'en'],
    adapters: {
        main: svelte({ loader: 'sveltekit', heuristic: svelteDefaultHeuristicDerivedReq }),
        js: js({
            loader: 'vite',
            files: [
                'src/**/+{page,layout}.{js,ts}',
                'src/**/+{page,layout}.server.{js,ts}',
                'src/lib/components/tabsNav.ts',
                'src/lib/eventCategories.ts'
            ],
        })
    },
    ai: {
        name: "gpt-5.6-luna",
        group: {},
        batchSize: 50,
        parallel: 3,
        translate: async (messages, instruction) => {
            console.time('translation took');
            const { text } = await generateText({
                model: openai('gpt-5.6-luna'),
                system: instruction,
                prompt: messages,
                providerOptions: {
                    openai: {
                        reasoningEffort: 'low',
                    },
                },
            })
            console.timeEnd('translation took');
            return text
        }
      },
})