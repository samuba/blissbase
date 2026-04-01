import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { allTags } from './tags';
import { WEBSITE_SCRAPE_SOURCE_URLS } from '../commonWithScripts';

/**
 * Extracts structured event fields from free text (same pipeline as the Telegram bot).
 *
 * @example
 * await aiExtractEventData(`Yoga Workshop Samstag 10 Uhr Berlin`, new Date(), `Europe/Berlin`);
 */
export async function aiExtractEventData(
	message: string,
	messageDate: Date,
	timezone: string,
	authorName?: string,
	imageInputs: (AiImageInput | undefined)[] = []
): Promise<MsgAnalysisAnswer> {
	console.time(`🤖 AI extracting event data with ${imageInputs.length} images`);
	const { text } = await generateText({
		model: google("gemini-3.1-flash-lite-preview"),
		system: msgAnalysisSystemPrompt(messageDate, timezone, authorName),
		messages: [
			{
				role: `user`,
				content: [
					{
						type: `text`,
						text: message
					},
					...imageInputs.filter((x) => !!x).map((imageInput) => buildAiImagePart(imageInput!))
				]
			}
		]
	});

	try {
		const result = JSON.parse(text || `{ "hasEventData": false }`) as MsgAnalysisAnswer;
		if (result.hasEventData) {
			if (!Array.isArray(result.contact)) result.contact = [];
			if (!Array.isArray(result.tags)) result.tags = [];
		}
		console.timeEnd(`🤖 AI extracting event data with ${imageInputs.length} images`);
		return result;
	} catch (e) {
		const errorMessage = e instanceof Error ? e.message : String(e);
		const msg = `Failed to parse OpenAI response as JSON: ${errorMessage}`;
		console.error(`AI answer: `, text);
		throw new Error(msg);
	}
}

/**
 * Normalizes app image inputs into AI SDK image parts.
 * @example
 * buildAiImagePart({ image: Buffer.from(`abc`), mediaType: `image/webp` })
 */
function buildAiImagePart(imageInput: AiImageInput) {
	if (typeof imageInput === `string`) {
		return {
			type: `image` as const,
			image: normalizeAiImageValue(imageInput)
		};
	}
	if (imageInput instanceof URL) {
		return {
			type: `image` as const,
			image: imageInput
		};
	}

	const part = {
		type: `image` as const,
		image: normalizeAiImageValue(imageInput.image)
	};
	if (!imageInput.mediaType) return part;

	return {
		...part,
		mediaType: imageInput.mediaType
	};
}

/**
 * Converts URL-like strings into URL objects and keeps inline data as-is.
 * @example
 * normalizeAiImageValue(`https://example.com/poster.webp`)
 */
function normalizeAiImageValue(image: AiImageValue) {
	if (image instanceof URL) return image;
	if (typeof image !== `string`) return image;
	if (!image.startsWith(`http://`) && !image.startsWith(`https://`)) return image;
	return new URL(image);
}

export const msgAnalysisSystemPrompt = (messageDate: Date, timezone: string, authorName?: string) => `
Your purpose is to analyze messenger text messages and images to extract information about events from them. 
Ignore messages that are not event announcements by setting hasEventData to false. (Be strict about this. E.g. this is not an event announcement: "..Wir haben noch einen Platz frei für den nächsten Tantra event..")
Answer only in valid, properly escaped, raw JSON. Do not wrap it inside markdown or anything else.
Do not explain anything.
If you can not find the information for a certain field do not return that field. Leave it out. 
Never make up any information. Only use the information provided in the message or image!
If there was an image attached, consider all text on the image as part of the message. For image-only messages (flyers), extract all visible text and treat it as the message content.
If there are links present in the message that start with any of the following strings (existing sources), set hasEventData to false and existingSource to the domain name of the source (e.g. awara.events, sei.jetzt.) and do not include anything else.
# existing sources:
${WEBSITE_SCRAPE_SOURCE_URLS.join(`\n`)}

When extracting dates and time, assume ${timezone} time unless you know for sure the location is in another timezone, be sure to take correct daylight saving time into account.
Today is  ${new Date().toLocaleDateString(`en-US`, { year: `numeric`, month: `long`, day: `numeric` })}
But the message was sent on ${messageDate.toLocaleDateString(`en-US`, { year: `numeric`, month: `long`, day: `numeric` })}.
${authorName ? `Author's name of this message: ${authorName}` : ``}

Extract these information from the message:

"hasEventData": boolean. wether or not the message contains information about an event.

"existingSource": string. 

"name": string. the name of the event. needs to be an exact copy from the message. Do not include html tags. If it is written in fancy unicode characters like ℬ for b or 𝐂 for C convert it to normal characters. If the name begins with "Einladung zum" or something similar, remove that part as its obvious that every event is an invitation. if the name contains a location like ".. in Berlin" remove that part. if there is no name in the text create a short descriptive name with not much personality. Prefer descriptive names over names that are too short.

"description": string. A exact copy from the message, including html tags, do not convert <br> tags to \n. Preserve line breaks using \n. Preserve emojis and other special characters. Do not include the extracted name of the event at the start of the description. If it contains links that are not wrapped in <a> tags, wrap them in <a> tags. From extracted images only include the information that is not already in the message.

"descriptionBrief": string. The same content as in "description" field, including html tags. Remove name/title, start time, end time if they were extracted into other fields.

"startDate": string. The date and time of the event start. Assume ${timezone} time zone if no other country is mentioned. Return as ISO 8601 with timezone. If you can only find date and not time assume start of the day. If multiple start dates are mentioned take the one thats in the future and closest to today. 

"endDate": string. The date and time of the event end. Assume ${timezone} time zone if no other country is mentioned. Return as ISO 8601 with timezone. ONLY if specified in the message.

"url": string. if the text contains a url that likely represents the event and has more information about it, insert it in this field. Never consider google maps urls for this. Never consider urls for this that start with "https://t.me".

"contact": Array<string>. If the text contains contact or registration information like messenger handles, URLs, phonenumbers etc that could be used to contact the event host or register for the event. Add main registration/contact method first. It needs to be a string which can contact the event host. (no "via dm")

"contactAuthorForMore": boolean. Wether the message states to contact the author of the message via messenger or phone to register/attend or get more information about the event. Only true if there is no other means of contact specified in the message. E.g. if there is a contact email specified, this should be false.

"price": string. The price or costs of the event for the guest. Do not include html tags. If the price information includes new lines or is longer than 100 characters do not extract the price.

"venue": string. Name of the location/venue where the event is taking place. Do not include html tags.

"address": string. The full address where the event is happening. Do not include html tags.

"attendanceMode": string. The method of attendance for the event. Can be "online", "offline" or "offline+online" (means both offline and online attendance is possible).

"city": string. Name of the city/town where the event is happening.

"emojis": string. Up to 3 emojis that describe the event.

"tags": Array<string>. Tags that describe the event. Use the tags from the following list, only use tags that are not on the list if you think its REALLY necessary: ${allTags.map((x) => x.en).join(`, `)}.

"isConscious": bool. Wether event is interesting to conscious people. Yes: Meditation, Ecstatic Dance, Sexual, Body, Spiritual etc. No: club dance, pure sport, pure business etc

`;

export type MsgAnalysisAnswer = {
	hasEventData: boolean;
	contact: string[];
	tags: string[];
} & Partial<{
	existingSource: string;
	name: string;
	description: string;
	descriptionBrief: string;
	startDate: string;
	endDate: string;
	url: string;
	contactAuthorForMore: boolean;
	price: string;
	venue: string;
	address: string;
	attendanceMode: 'online' | 'offline' | 'offline+online';
	city: string;
	emojis: string;
	isConscious: boolean;
}>;

export type AiImageInput = string | URL | {
	image: AiImageValue;
	mediaType?: string;
};

type AiImageValue = ArrayBuffer | Buffer | Uint8Array | string | URL;
