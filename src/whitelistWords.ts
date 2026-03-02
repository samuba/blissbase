
import whitelistWords from './whitelistWords.json' with { type: 'json' };

const blackListWords = [
    "escape game",
    "escape games",
    "escape room",
    "escape rooms",
    "machine learning",
    'hatha yoga',
    'hatha-yoga',
    'yin yoga',
    'yin-yoga',
    'yoga im ',
    'yoga für ',
    'vinyasa',
    'ashtanga',
    'gentle flow',
    'slow flow',
    'pilates',
    'beginner yoga',
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

const whiteListWordsRegex = flatWhiteListWords.map(x => {
    const words = [x.word, ...x.synonyms]
    return new RegExp(`(^|\\s|\\W)(${words.join("|")})($|\\s|\\W)`, 'i')
})

export function matchesWhiteListWords(text: string) {
    if (!text) return false;
    return whiteListWordsRegex.some(regex => regex.test(text))
}

export function matchesBlackListWords(text: string) {
    if (!text) return false;
    return blackListWords.some(x => text.toLowerCase().includes(x));
}