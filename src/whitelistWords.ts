
import whitelistWords from './whitelistWords.json' with { type: 'json' };

const blackListWords = [
    "escape game",
    "escape games",
    "escape room",
    "escape rooms",
    "machine learning",
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
    if (blackListWords.some(x => text.toLowerCase().includes(x))) return false;
    return whiteListWordsRegex.some(regex => regex.test(text))
}