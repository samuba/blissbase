// @ts-check
import { adapter as svelte } from "@wuchale/svelte"
import { adapter as js } from 'wuchale/adapter-vanilla'
import { defineConfig } from "wuchale"
import { generateText } from 'ai';
import 'dotenv/config';

export default defineConfig({
    // first locale is the source locale
    locales: ['de', 'en'],
    adapters: {
        main: svelte({ loader: 'sveltekit' }),
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
        name: "luna",
        group: {},
        batchSize: 50,
        parallel: 3,
        translate: async (messages, instruction) => {
            console.time('translation took');
            const { text } = await generateText({
                model: `openai/gpt-6-luna`,
                providerOptions: { gateway: { inferenceRegion: { scope: "zone", geoRegion: "eu" } } },
                reasoning: `low`,
                system: `${instruction}\n\nGlossary: the noun "Angebot" is "offering" and "Angebote" is "offerings". Never translate those nouns as "deal", "deals", "offer", "offers", "listing", or "listings".`,
                prompt: messages,
            })
            console.timeEnd('translation took');
            return text
        }
      },
})
