import { choice, noul, type NoulResponse } from "@typesafe-ai/sdk";
import { stripHtml } from "../../common";
import { eventStructureSlugs, type EventStructure } from "../../eventCategories";
import {
	aiExtractEventData,
	aiTranscribeImage,
	eventLanguages,
	getExistingSource,
	JEV_CLOSED_EXTRACTION_FIELDS,
	type AiExtractEventDataArgs,
	type AiImageInput,
	type EventLanguage,
	type MsgAnalysisAnswer,
} from "../ai";
import { jevClient } from "./client";
import { tagNouls, tagsFromNouls } from "./tagQuestions";

const NOUL_YES = 0.5;

/**
 * Text messages: one Jev call, then Luna only if it passes.
 * Image messages: Luna transcribes the image, Jev judges caption plus transcript, then Luna extracts without the image.
 * A failed Jev call or a failed transcription keeps the current full extraction path.
 */
export async function resolveMessengerAnalysis(args: ResolveMessengerAnalysisArgs): Promise<MsgAnalysisAnswer> {
	const existingSource = getExistingSource(args.message);
	if (existingSource) return { hasEventData: false, existingSource };

	const imageInputs = args.imageInputs?.filter((input) => !!input) as AiImageInput[] ?? [];
	if (imageInputs.length) return resolveImageAnalysis({ args, imageInputs });

	const text = messageTextForJev(args.message);
	if (!text.length) {
		console.log(`[jev] No text to judge; continuing with LLM extraction`);
		return extractOnlyWithLlm(args);
	}

	return judgeThenExtract({ args, text, msgForLlm: args.message });
}

async function resolveImageAnalysis({ args, imageInputs }: { args: ResolveMessengerAnalysisArgs; imageInputs: AiImageInput[] }) {
	let transcript: string;
	try {
		transcript = await aiTranscribeImage({ imageInputs });
	} catch (error) {
		console.warn(`[jev] image transcription failed; continuing with LLM extraction`, error);
		return extractOnlyWithLlm(args);
	}

	const msgForLlm = messageWithImageTranscript({ caption: args.message, transcript });
	const sourceInImage = getExistingSource(msgForLlm);
	if (sourceInImage) return { hasEventData: false, existingSource: sourceInImage };

	const text = messageTextForJev(msgForLlm);
	if (!text.length) return extractOnlyWithLlm(args);

	return judgeThenExtract({ args, text, msgForLlm, ignoreImages: true });
}

async function judgeThenExtract(args: {
	args: ResolveMessengerAnalysisArgs;
	text: string;
	msgForLlm: string;
	ignoreImages?: boolean;
}) {
	let judgment: MessengerJudgment;
	try {
		const { answers } = await askJev(args.text);
		judgment = interpretJevAnswer({
			answers,
			eventIsDefinitelyConscious: args.args.eventIsDefinitelyConscious,
		});
	} catch (error) {
		console.warn(`[jev] messenger check failed; continuing with LLM extraction`, error);
		return extractOnlyWithLlm(args.args);
	}

	if (`skipReason` in judgment) {
		console.log(`[jev] Skipping message — ${judgment.skipReason}`);
		return { hasEventData: false };
	}

	await args.args.beforeLlmExtract?.();
	const aiAnswer = await aiExtractEventData({
		...args.args,
		message: args.msgForLlm,
		imageInputs: args.ignoreImages ? [] : args.args.imageInputs,
		omitFields: judgment.omitFields,
	});

	if (!aiAnswer.hasEventData || aiAnswer.existingSource) return aiAnswer;
	aiAnswer.tags = judgment.tags;
	aiAnswer.structure = judgment.structure;
	aiAnswer.language = judgment.language;
	aiAnswer.attendanceMode = judgment.attendanceMode;
	aiAnswer.contactAuthorForMore = judgment.contactAuthorForMore;
	aiAnswer.isConscious = true;
	aiAnswer.hasEventData = true;
	aiAnswer.existingSource = undefined;
	return aiAnswer;

}

async function extractOnlyWithLlm(args: ResolveMessengerAnalysisArgs) {
	await args.beforeLlmExtract?.();
	return aiExtractEventData(args);
}

function messageWithImageTranscript({ caption, transcript }: { caption: string; transcript: string }) {
	const imageText = transcript.trim();
	const captionText = caption.trim();
	if (!captionText) return imageText;
	return `${captionText}\n\n${imageText}`;
}

export function messageTextForJev(message: string) {
	const withBreaks = message.replace(/<br\s*\/?>/gi, `\n`);
	return stripHtml(withBreaks)?.replaceAll(`\u00a0`, ` `).trim() ?? ``;
}

export function interpretJevAnswer(args: {
	answers: JevAnswers;
	eventIsDefinitelyConscious: boolean;
}) {
	const { is_event, has_start_date, is_conscious, attendance, contact_author, language, event_structure } = args.answers;

	if (isFalse(is_event)) return { skipReason: `not an event announcement` };
	if (isFalse(has_start_date)) return { skipReason: `no start date` };
	const isConscious = args.eventIsDefinitelyConscious || isTrue(is_conscious);
	if (!isConscious) return { skipReason: `not a conscious event` };

	const attendanceMode = attendance.confidence >= 0.5 && attendance.choice !== `unknown`
		? attendance.choice
		: `offline`;
	const contactAuthorForMore = isTrue(contact_author);
	const tags = tagsFromNouls(args.answers);
	const structure = chosenEventStructure(event_structure);
	const eventLanguage = chosenEventLanguage(language);

	return {
		tags,
		structure,
		language: eventLanguage,
		attendanceMode,
		contactAuthorForMore,
		omitFields: JEV_CLOSED_EXTRACTION_FIELDS,
	};
}

const eventStructureSlugSet = new Set<string>(eventStructureSlugs);
const eventLanguageSlugSet = new Set<string>(eventLanguages);

function chosenEventStructure(answer: { choice: string; confidence: number }): EventStructure | undefined {
	if (answer.confidence < 0.5) return;
	if (!eventStructureSlugSet.has(answer.choice)) return;
	return answer.choice as EventStructure;
}

function chosenEventLanguage(answer: { choice: string; confidence: number }): EventLanguage | undefined {
	if (answer.confidence < 0.5) return;
	if (!eventLanguageSlugSet.has(answer.choice)) return;
	return answer.choice as EventLanguage;
}

function isTrue(answer: NoulResponse) {
	return answer.noul >= NOUL_YES
}

function isFalse(answer: NoulResponse) {
	return answer.noul < NOUL_YES
}

export async function askJev(text: string) {
	const result = await jevClient().systemOne({
		state: { message: text },
		questions: {
			is_event: noul(`Could the message be an event announcement?`, {
				true: `A gathering, class, workshop, ceremony, or similar.`,
			}),
			has_start_date: noul(`Does the message state a start date or a specific day for the event?`, {
				true: `A calendar date, a weekday, or a relative day such as tomorrow is given.`,
			}),
			is_conscious: noul(`Is this a conscious, somatic, spiritual, sexual, ritual, community, or self-development event?`, {
				true: `Ecstatic dance, tantra, breathwork, meditation, ceremony, or a similar conscious/hippie event.`,
				false: `A generic gym class, club night, pure sport, or business meetup.`,
			}),
			contact_author: noul(
				`Does the message say to contact the author via messenger or phone to register or learn more, and give no other contact method?`,
				{
					true: `The author is the only way to register or get details.`,
					false: `Another contact method is given, like a website or email address, or the message does not ask to contact the author.`,
				},
			),
			attendance: choice(`How can people attend the event described in the message?`, {
				online: `Online only. No in-person gathering.`,
				offline: `People meeting in person.`,
				"offline+online": `Its possible to attend in person and online.`,
				unknown: null,
			}),
			language: choice(`Whats the events main language?`, {
				english: null,
				spanish: null,
				portuguese: null,
				french: null,
				german: null,
				dutch: null,
				russian: null,
				ukrainian: null,
				other: null,
				multiple: null,
			}),
			event_structure: choice(`How is this event structured?`, {
				festival: null,
				retreat: `One contained immersion: e.g. day retreat, camp, multi-day seminar.`,
				session: `One sitting: e.g. workshop, class, circle, jam, concert`,
				course: `A course/training/program that meets more than once.`,
				conference: `A conference/congress with several sessions.`,
				none: `None of these. The message gives no hint on how its structured.`,
			}),
			...tagNouls(),
		},
	});
	console.log(`[jev] ${result.model} (${result.usage?.input_tokens ?? 0} input tokens)`);
	//console.debug(`[jev] result ${JSON.stringify(result, null, 2)}`);
	return result
}

type JevAnswers = Awaited<ReturnType<typeof askJev>>['answers'];

type ResolveMessengerAnalysisArgs = AiExtractEventDataArgs & {
	beforeLlmExtract?: () => Promise<unknown> | unknown;
};

type MessengerJudgment = ReturnType<typeof interpretJevAnswer>;