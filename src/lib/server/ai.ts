import { generateText, jsonSchema, NoObjectGeneratedError, NoOutputGeneratedError, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { allTags } from './tags';
import { WEBSITE_SCRAPE_SOURCE_URLS } from '../commonWithScripts';

/**
 * Extracts structured event fields from free text (same pipeline as the Telegram bot).
 */
export async function aiExtractEventData(args: AiExtractEventDataArgs): Promise<MsgAnalysisAnswer> {
	const {
		message,
		messageDate,
		timezone,
		authorName,
		imageInputs = [],
		model,
		eventIsDefinitelyConscious,
	} = args;
	console.time(`🤖 AI extracting event data with ${imageInputs.length} images`);
	try {
		const { output, usage } = await generateText({
			model: openai(model),
			providerOptions: {
				openai: {
					reasoningEffort: 'high',
				},
			},
			output: Output.object({
				name: `eventExtraction`,
				schema: buildMsgAnalysisSchema(timezone)
			}),
			system: msgAnalysisSystemPrompt(messageDate, timezone, eventIsDefinitelyConscious, authorName),
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
		console.debug("ai usage", usage)

		const result = normalizeMsgAnalysisAnswer(output);
		if (result.hasEventData) {
			if (!Array.isArray(result.contact)) result.contact = [];
			if (!Array.isArray(result.tags)) result.tags = [];
			if (args.eventIsDefinitelyConscious) result.isConscious = true;
		}

		return result;
	} catch (error) {
		if (!isNoGeneratedEventOutputError(error)) throw error;

		console.warn(`[ai] No structured event output generated; treating message as non-event`);
		return { hasEventData: false };
	} finally {
		console.timeEnd(`🤖 AI extracting event data with ${imageInputs.length} images`);
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

function isNoGeneratedEventOutputError(error: unknown) {
	if (NoOutputGeneratedError.isInstance(error)) return true;
	if (NoObjectGeneratedError.isInstance(error)) return true;
	return false;
}

export const msgAnalysisSystemPrompt = (messageDate: Date, timezone: string, _eventIsDefinitelyConscious: boolean, authorName?: string) => `
Your purpose is to analyze messenger text messages and images to extract information about events from them. 
Ignore messages that are not event announcements by setting hasEventData to false. (Be strict about this. E.g. this is not an event announcement: "..Wir haben noch einen Platz frei für den nächsten Tantra event..")
Do not explain anything.
If you can not find the information for a certain field return null for that field.
Never make up any information. Only use the information provided in the message or image!
If there was an image attached, consider all text on the image as part of the message. For image-only messages (flyers), extract all visible text and treat it as the message content.
If there are links present in the message that start with any of the following strings (existing sources), set hasEventData to false and existingSource to the domain name of the source (e.g. sei.jetzt.) and do not include anything else.
# existing sources:
${WEBSITE_SCRAPE_SOURCE_URLS
		.filter(x => !x.includes(`megatix.co.id`)) // dont include megatix because most events are not publicly listed
		.join(`\n`)}

When extracting dates and time, assume ${timezone} time unless you know for sure the location is in another timezone, be sure to take correct daylight saving time into account.
Today is  ${new Date().toLocaleDateString(`en-US`, { year: `numeric`, month: `long`, day: `numeric` })}
But the message was sent on ${messageDate.toLocaleDateString(`en-US`, { year: `numeric`, month: `long`, day: `numeric` })}.
${authorName ? `Author's name of this message: ${authorName}` : ``}

Fill each output field according to the JSON schema property descriptions.
`;

/**
 * Removes schema-required nulls from AI output so callers keep the old optional-field API.
 * @example
 * normalizeMsgAnalysisAnswer({ hasEventData: false, name: null, contact: null, tags: null })
 */
function normalizeMsgAnalysisAnswer(answer: RawMsgAnalysisAnswer): MsgAnalysisAnswer {
	const result: MsgAnalysisAnswer = {
		hasEventData: answer.hasEventData
	};

	if (answer.existingSource !== null) result.existingSource = answer.existingSource;
	if (answer.name !== null) result.name = answer.name;
	if (answer.description !== null) {
		result.description = normalizeDescription({
			description: answer.description,
			name: answer.name
		});
	}
	if (answer.startDate !== null) result.startDate = answer.startDate;
	if (answer.endDate !== null) result.endDate = answer.endDate;
	if (answer.url !== null) result.url = answer.url;
	if (answer.contact !== null) result.contact = answer.contact;
	if (answer.contactAuthorForMore !== null) result.contactAuthorForMore = answer.contactAuthorForMore;
	if (answer.price !== null) result.price = answer.price;
	if (answer.venue !== null) result.venue = answer.venue;
	if (answer.address !== null) result.address = answer.address;
	if (answer.attendanceMode !== null) result.attendanceMode = answer.attendanceMode;
	if (answer.city !== null) result.city = answer.city;
	if (answer.emojis !== null) result.emojis = answer.emojis;
	if (answer.tags !== null) result.tags = answer.tags;
	if (answer.isConscious !== null) result.isConscious = answer.isConscious;

	return result;
}

/**
 * Applies deterministic description cleanup for rules that models often miss.
 * @example
 * normalizeDescription({ description: `Event\n\nMore: https://example.com`, name: `Event` })
 */
export function normalizeDescription(args: { description: string; name: string | null }) {
	const descriptionWithoutName = removeLeadingEventName({
		description: args.description,
		name: args.name
	});
	return linkifyBareUrls(descriptionWithoutName);
}

const LEADING_NAME_SEPARATOR_REGEX = /^(?:\s*\n+|\s*[:.\-–—]\s*)/;

function removeLeadingEventName(args: { description: string; name: string | null }) {
	if (!args.name) return args.description;
	const leadingNameEndIndex = findLeadingNameEndIndex({
		description: args.description,
		name: args.name
	});
	if (leadingNameEndIndex === null) return args.description;

	const descriptionAfterName = args.description.slice(leadingNameEndIndex);
	if (!descriptionAfterName.trim()) return ``;
	if (!LEADING_NAME_SEPARATOR_REGEX.test(descriptionAfterName)) return args.description;

	return descriptionAfterName.replace(LEADING_NAME_SEPARATOR_REGEX, ``);
}

function findLeadingNameEndIndex(args: { description: string; name: string }) {
	const normalizedName = normalizeComparableText(args.name);
	if (!normalizedName) return null;

	let normalizedSoFar = ``;
	let originalIndex = 0;
	for (const char of args.description) {
		normalizedSoFar += normalizeComparableText(char);
		originalIndex += char.length;
		if (normalizedSoFar === normalizedName) return originalIndex;
		if (!normalizedName.startsWith(normalizedSoFar)) return null;
	}

	return null;
}

function normalizeComparableText(text: string) {
	return text.normalize(`NFKC`).toLocaleLowerCase();
}

const TRAILING_URL_PUNCTUATION_REGEX = /[)\]},.!?;:]+$/;
const PRESERVED_HTML_ENTITY_REGEX = /&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);/y;

/**
 * Wraps bare URLs in anchors while leaving existing anchor tags untouched.
 * @example
 * linkifyBareUrls(`More: https://example.com`)
 */
function linkifyBareUrls(text: string) {
	return text.replace(/https?:\/\/[^\s<]+/g, (match, offset) => {
		if (isInsideAnchorTag({ text, offset })) return match;

		const trailingPunctuation = match.match(TRAILING_URL_PUNCTUATION_REGEX)?.[0] ?? ``;
		const url = trailingPunctuation ? match.slice(0, -trailingPunctuation.length) : match;
		return `<a href="${escapeHtmlAttribute(url)}">${escapeHtmlText(url)}</a>${trailingPunctuation}`;
	});
}

function escapeHtmlAttribute(text: string) {
	return escapeHtmlText(text).replaceAll(`"`, `&quot;`).replaceAll(`'`, `&#39;`);
}

/** Escapes HTML special characters while preserving already-encoded entities. */
function escapeHtmlText(text: string) {
	let result = ``;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (char === `&`) {
			PRESERVED_HTML_ENTITY_REGEX.lastIndex = i;
			const entityMatch = PRESERVED_HTML_ENTITY_REGEX.exec(text);
			if (entityMatch) {
				result += entityMatch[0];
				i += entityMatch[0].length - 1;
				continue;
			}
			result += `&amp;`;
			continue;
		}
		if (char === `<`) {
			result += `&lt;`;
			continue;
		}
		if (char === `>`) {
			result += `&gt;`;
			continue;
		}
		result += char;
	}
	return result;
}

function isInsideAnchorTag(args: { text: string; offset: number }) {
	const anchorStart = args.text.lastIndexOf(`<a`, args.offset);
	if (anchorStart === -1) return false;

	const anchorEnd = args.text.lastIndexOf(`</a>`, args.offset);
	return anchorStart > anchorEnd;
}

/** Builds extraction schema with timezone and tag-list wording in property descriptions. */
function buildMsgAnalysisSchema(timezone: string) {
	return jsonSchema<RawMsgAnalysisAnswer>({
		type: `object`,
		properties: {
			hasEventData: {
				type: `boolean`,
				description: `Whether or not the message contains information about an event.`
			},
			existingSource: {
				type: [`string`, `null`],
				description: `Domain name of the scrape source (e.g. sei.jetzt.) when the message contains a link that starts with one of the configured existing source URLs; otherwise null. When set, hasEventData must be false and no other event fields should be filled.`
			},
			name: {
				type: [`string`, `null`],
				description: `The name of the event. Must be an exact copy from the message. Do not include html tags. If it is written in fancy unicode characters like ℬ for b or 𝐂 for C, convert it to normal characters. If the name begins with "Einladung zum" or something similar, remove that part as it is obvious that every event is an invitation. If the name contains a location like ".. in Berlin", remove that part. If there is no name in the text, create a short descriptive name with not much personality. Prefer descriptive names over names that are too short.`
			},
			description: {
				type: [`string`, `null`],
				description: `An exact copy from the message, including html tags; do not convert <br> tags to line breaks. Preserve line breaks using \\n. Preserve emojis and other special characters. Do not include the extracted name of the event at the start of this field. From extracted images only include information that is not already in the message.`
			},
			startDate: {
				type: [`string`, `null`],
				description: `The date and time of the event start. Assume ${timezone} time zone if no other country is mentioned. Return as ISO 8601 with timezone. If you can only find a date and not a time, assume start of the day. If multiple start dates are mentioned, take the one that is in the future and closest to today.`
			},
			endDate: {
				type: [`string`, `null`],
				description: `The date and time of the event end. Assume ${timezone} time zone if no other country is mentioned. Return as ISO 8601 with timezone. Set null if not specified in the message.`
			},
			url: {
				type: [`string`, `null`],
				description: `If the text contains a URL that likely represents the event and has more information about it, put it here. Never use Google Maps URLs. Never use URLs that start with "https://t.me".`
			},
			contact: {
				type: [`array`, `null`],
				items: { type: `string` },
				description: `Contact or registration information. Each item must be a valid href value. Examples: https://exa.com, https://wa.me/+1234567890, mailto:ex@mpl.de, tel:+12345, tg://resolve?domain=username. List the main registration/contact method first.`
			},
			contactAuthorForMore: {
				type: [`boolean`, `null`],
				description: `Whether the message states to contact the author of the message via messenger or phone to register, attend, or get more information about the event. Only true if there is no other means of contact specified in the message. For example, if a contact email is specified, this must be false.`
			},
			price: {
				type: [`string`, `null`],
				description: `The price or cost of the event for the guest. Do not include html tags. If the price information includes new lines or is longer than 100 characters, do not extract the price (return null).`
			},
			venue: {
				type: [`string`, `null`],
				description: `Name of the location or venue where the event is taking place. Do not include html tags.`
			},
			address: {
				type: [`string`, `null`],
				description: `The full address where the event is happening. Do not include html tags.`
			},
			attendanceMode: {
				type: [`string`, `null`],
				enum: [`online`, `offline`, `offline+online`, null],
				description: `The method of attendance for the event. Use "online", "offline", or "offline+online" when both offline and online attendance are possible.`
			},
			city: {
				type: [`string`, `null`],
				description: `Name of the city or town where the event is happening.`
			},
			emojis: {
				type: [`string`, `null`],
				description: `Up to 3 emojis that describe the event.`
			},
			tags: {
				type: [`array`, `null`],
				items: { type: `string` },
				description: `Tags that describe the event. Prefer tags from this list; only use a tag not on the list if you think it is really necessary: ${allTags.map((x) => x.en).join(`, `)}.`
			},
			isConscious: {
				type: [`boolean`, `null`],
				description: `Whether the event is interesting to conscious people. Yes: Ecstatic dance, sexual, somatic, spiritual, community, self development, ritual, etc. No: club dance, pure sport, pure business, etc.`
			}
		},
		required: [
			`hasEventData`,
			`existingSource`,
			`name`,
			`description`,
			`startDate`,
			`endDate`,
			`url`,
			`contact`,
			`contactAuthorForMore`,
			`price`,
			`venue`,
			`address`,
			`attendanceMode`,
			`city`,
			`emojis`,
			`tags`,
			`isConscious`
		],
		additionalProperties: false
	});
}

export type MsgAnalysisAnswer = {
	hasEventData: boolean;
	contact?: string[];
	tags?: string[];
} & Partial<{
	existingSource: string;
	name: string;
	description: string;
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

export type AiExtractEventDataArgs = {
	message: string;
	messageDate: Date;
	timezone: string;
	authorName?: string;
	imageInputs?: (AiImageInput | undefined)[];
	model: `gpt-5.4-nano` | `gpt-5-mini`;
	eventIsDefinitelyConscious: boolean;
};

type RawMsgAnalysisAnswer = {
	hasEventData: boolean;
	existingSource: string | null;
	name: string | null;
	description: string | null;
	startDate: string | null;
	endDate: string | null;
	url: string | null;
	contact: string[] | null;
	contactAuthorForMore: boolean | null;
	price: string | null;
	venue: string | null;
	address: string | null;
	attendanceMode: 'online' | 'offline' | 'offline+online' | null;
	city: string | null;
	emojis: string | null;
	tags: string[] | null;
	isConscious: boolean | null;
};
