const GERMAN_SOURCES = new Set([
	`heilnetz`,
	`heilnetzowl`,
	`tribehaus`,
	`seijetzt`,
	`tantrakalender`,
	`tantrazentrumleipzig`,
	`kuschelraum`,
	`dieliebelle`,
	`ggbrandenburg`,
	`soulwise`,
]);

const INDONESIAN_SOURCES = new Set([`megatix_indonesia`, `balievents`]);

const GERMAN_MARKERS =
	/[äöüÄÖÜß]|\b(und|der|die|das|mit|für|ein|eine|zum|zur|im|am|von|auf|nicht|oder|auch|sich|den|dem|des|ist|sind|tanz|körper|atem|herz|gemeinschaft)\b/;
const INDONESIAN_MARKERS = /\b(dan|yang|untuk|dari|dengan|ini|acara|di|yang|pada|sebuah)\b/;

export function guessLanguage({
	name,
	description,
	source,
}: {
	name: string;
	description?: string | null;
	source?: string | null;
}): GoldLanguage {
	const text = `${name} ${description ?? ``}`;
	if (GERMAN_MARKERS.test(text) || (source != null && GERMAN_SOURCES.has(source))) return `de`;
	if (INDONESIAN_MARKERS.test(text) || (source != null && INDONESIAN_SOURCES.has(source))) return `id`;
	if (/[a-zA-Z]/.test(text)) return `en`;
	return `other`;
}

type GoldLanguage = `de` | `en` | `id` | `other`;
