// @ts-check
import { adapter as svelte } from "@wuchale/svelte"
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
    ai: {
        name: "gpt-5-mini",
        batchSize: 50,
        parallel: 3,
        translate: async (messages, instruction) => {
            const { text } = await generateText({
                model: openai('gpt-5-mini'),
                system: instruction,
                prompt: messages,
            })
            return text
        }
      },
})