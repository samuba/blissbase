import { noul } from "@typesafe-ai/sdk";
import { jevClient } from "./client";
import { broadestTagSlugs } from "../../eventCategories";

const MAX_TAGS = 4;

export function tagNouls() {
	const questions = {} as Record<(typeof broadestTagSlugs)[number], ReturnType<typeof noul>>;
	for (const slug of broadestTagSlugs) {
		const label = slug.replaceAll(`-`, ` `);
		questions[slug] = noul(`Is this a ${label} event?`, { true: tagYes[slug] });
	}
	return questions;
}

export function tagsFromNouls(answers: { [slug in (typeof broadestTagSlugs)[number]]: { noul: number } }) {
	return broadestTagSlugs
		.map((slug) => ({ slug, noul: answers[slug].noul }))
		.filter((tag) => tag.noul >= 0.45)
		.sort((a, b) => b.noul - a.noul)
		.slice(0, MAX_TAGS)
		.map((tag) => tag.slug);
}

export async function suggestTagsWithJev(text: string) {
	const result = await jevClient().systemOne({
		state: { message: text },
		questions: tagNouls(),
	});
	console.log(`[jev] ${result.model} (${result.usage?.input_tokens ?? 0} input tokens)`);
	return tagsFromNouls(result.answers);
}

const tagYes = {
	meditation: `e.g. guided meditation, mindfulness, vipassana, zen, silence`,
	dance: `e.g. ecstatic dance, 5Rhythms, contact improvisation, biodanza`,
	music: `A concert, live music, jam, or drum circle. Not a singing circle or sound bath`,
	ceremony: `e.g. ritual, cacao ceremony, sweat lodge, plant medicine`,
	"sound-healing": `e.g. sound bath, sound journey, gong bath, singing bowls`,
	tantra: `e.g. classical tantra, neo-tantra, temple night, sexual energy`,
	intimacy: `e.g. sensuality, sexuality, cuddling, shibari, tantra, play party, temple night`,
	"inner-work": `Therapy, constellations, shadow work, trauma work, or grief work`,
	health: `Sauna, ayurveda, fasting, nervous-system regulation, or self-care`,
	breathwork: `Breathwork like holotropic, rebirthing, or ice bath, wim hof method, pranayama, others etc.`,
	yoga: `e.g. vinyasa, acro yoga, hatha, ashtanga`,
	nature: `e.g. hiking, forest, herbalism, foraging`,
	bodywork: `Massage, shiatsu, craniosacral work, other hands-on bodywork`,
	voice: `Mainly about voice. e.g. Singing, kirtan, mantra singing, voice work`,
	relationship: `e.g. Relating, dating, couples work, nonviolent communication`,
	creativity: `Art, writing, theatre, or crafts`,
	"energy-work": `e.g. Reiki, chakra, kundalini activation, chi, aura, qigong`,
	spirituality: `e.g. spiritual teaching, satsang, nonduality, astrology, tarot, human design`,
	shamanism: `A shamanic journey, soul retrieval, or other shamanic practice`,
	movement: `Qigong, tai chi, pilates, feldenkrais, or martial arts. Not dance and not yoga`,
	circle: `A sharing circle, mixed circle, or queer gathering`,
	family: `e.g. Parenting, pregnancy, event for families, kids`,
	women: `Specifically for women`,
	men: `Specifically for men`,
} satisfies Record<(typeof broadestTagSlugs)[number], string>;

for (const slug of Object.keys(tagYes) as (typeof broadestTagSlugs)[number][]) {
	if (!broadestTagSlugs.includes(slug)) throw new Error(`tagYes tag missing from catalog: ${slug}`);
}
