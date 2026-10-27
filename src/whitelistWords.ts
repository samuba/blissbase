import type { WebsiteScrapeSourceName } from '$lib/commonWithScripts';
import whitelistWords from './whitelistWords.json' with { type: 'json' };

const blackListWords = [
    "escape game",
    "escape games",
    "escape room",
    "escape rooms",
    "machine learning",
    // no "normal" yoga classes
    'hatha yoga',
    'hatha-yoga',
    'hatha flow',
    'yin yoga',
    'yin-yoga',
    'yin flow',
    'power yoga',
    'yoga im ',
    'yoga am ',
    'yoga für ',
    'kids yoga',
    'sanftes yoga',
    'vinyasa',
    'ashtanga',
    'gentle flow',
    'slow flow',
    'pilates',
    'beginner yoga',
    'Engpassdehnungskurs',
    'Faszienyoga',
    'Faszien-Yoga',
    // no crypto 
    'bitcoin', 
    'crypto',
    'blockchain',
    'ethereum',
    // no low frequency
    'pub crawl',
    'business',
    'entrepreneur',
    'muay thai',
    'crossfit'
]

const flatWhiteListWords = whitelistWords.reduce((acc, cur) => {
    const synonyms = Object.values(cur.synonyms).flat();
    acc.push({ word: cur.word, synonyms });
    return acc;
}, [] as { word: string, synonyms: string[] }[])

const whiteListWordsRegex = flatWhiteListWords.flatMap(x => {
    const words = [x.word, ...x.synonyms]
        .map(word => word.trim())
        .filter(Boolean)
        .map(escapeRegex)
    if (!words.length) return []
    return [new RegExp(`(^|\\s|\\W)(${words.join("|")})($|\\s|\\W)`, 'i')]
})

function escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)
}

export function matchesWhiteListWords(text: string) {
    if (!text) return false;
    return whiteListWordsRegex.some(regex => regex.test(text))
}

export function matchesBlackListWords(text: string) {
    if (!text) return false;
    const haystack = text.toLowerCase();
    return blackListWords.some(x => haystack.includes(x.toLowerCase()));
}

export const whiteListSources = [
    'tribehaus',
    'heilnetz',
    'heilnetzowl',
    'seijetzt',
    'ggbrandenburg',
    'kuschelraum',
    'ciglobalcalendar',
    'vortexapp',
    'soulwise',
    'yogabarn',
    'tantrakalender',
    'tantrazentrumleipzig',
    'consciousevents',
    'dieliebelle',
    'wimhofmethod',
    'kayana',
] satisfies WebsiteScrapeSourceName[];

/**
 * Website scrapes list an event when the title or description matches the conscious-word list.
 * Titles like "DISSOLVE :: PLAY" miss the list even though the description is contact improvisation.
 *
 * @example
 * shouldListScrapedEvent({ name: `DISSOLVE :: PLAY`, description: `contact improvisation jam`, source: `megatix_indonesia` })
 */
export function shouldListScrapedEvent(args: {
    name: string;
    description?: string | null;
    source: WebsiteScrapeSourceName;
}) {
    if (matchesBlackListWords(args.name)) return false;
    if (whiteListSources.includes(args.source)) return true;
    const text = args.description ? `${args.name}\n${args.description}` : args.name;
    return matchesWhiteListWords(text);
}
