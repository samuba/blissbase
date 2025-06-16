// import { OPENAI_API_KEY, GEMINI_API_KEY } from "$env/static/private";


import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai'; // Ensure OPENAI_API_KEY environment variable is set


export async function aiExtractEventData(message: string, systemPrompt: string = ""): Promise<MsgAnalysisAnswer> {

    const { text } = await generateText({
        model: openai('o4-mini-2025-04-16'),
        system: systemPrompt,
        prompt: message,
    });

    try {
        return JSON.parse(text || '{ "hasEventData": false }') as MsgAnalysisAnswer;
    } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        const msg = `Failed to parse OpenAI response as JSON: ${errorMessage}`
        console.error(msg)
        throw new Error(msg);
    }
}

export const msgAnalysisSystemPrompt = () => `
Your purpose is to anaylze text messages and extract infos about an event from them. 
Ignore messages that are not event announcements by setting hasEventData to false. (Be strict about this. E.g. this is not an event announcement: "..Wir haben noch einen Platz frei für den nächsten Tantra event..")
Answer only in valid, raw JSON. Do not wrap it inside markdown or anything else.
Do not explain anything.
If you can not find the information for a certain field do not return that field. Leave it out. 
Never make up any information. Only use the information provided in the message!
When extracting dates and time, always assume german time unless stated otherwise, be sure to take correct daylight saving time into account.
Today is  ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.

Extract these information from the message:

"hasEventData": boolean. wether or not the message contains information about an event.

"name": string. the name of the event. needs to be an exact copy from the message. Do not include html tags. If it is written in fancy unicode characters like ℬ for b or 𝐂 for C convert it to normal characters. If the name begins with "Einladung zum" or something similar, remove that part as its obvious that every event is an invitation. if there is no name in the text create a short descriptive name with not much personality.

"description": string. A exact copy from the message, including html tags, do not convert <br> tags to \n. Preserve line breaks using \n. Preserve emojis and other special characters. Do not include the extracted name of the event at the start of the description.

"descriptionBrief": string. The same content as in "description" field, including html tags, but without the information that were extracted in other fields. E.g. if start date is extracted, do not include it. Only remove information that was extracted into other fields. If e.g. there are multiple contact methods, and you extract only one into the "contact" field, leave the other contact methods in the descriptionBrief.

"summary": string. Summarise what the event is about in one descriptive sentence. Always use same language as the message. Never mention name of the event. Never mention date or location. Always sound friendly and keep it about this event.

"startDate": string. The date and time of the event start. Assume german time zone if no other country is mentioned. Return as ISO 8601 with timezone. If you can only find date and not time assume start of the day.

"endDate": string. The date and time of the event end. Assume german time zone if no other country is mentioned. Return as ISO 8601 with timezone. ONLY if specified in the message.

"url": string. if the text contains a url that likely represents the event and has more information about it, insert it in this field. Never consider urls for this that start with "https://t.me".

"contact": string. If the text contains contact or registration information like messenger handles, URLs, phonenumbers etc that could be used to contact the event host or register for the event. Only add the main registration/contact method, not multiple.

"contactAuthorForMore": boolean. Wether the message states to contact the sender/author of the message via messenger or phone to register/attend or get more information about the event. Only true if there is no other means of contact specified in the message. E.g. if there is a contact email specified, this should be false.

"price": string. The price or costs of the event for the guest. Do not include html tags. If the price information includes new lines or is longer than 100 characters do not extract the price.

"venue": string. Name of the location/venue where the event is taking place. Do not include html tags.

"address": string. The full address where the event is happening. Do not include html tags.

"city": string. Name of the city/town where the event is happening.

"tags": string[]. Tags that describe the event.

"emojis": string. Up to 3 emojis that describe the event.

`


export type MsgAnalysisAnswer = {
    hasEventData: boolean;
} & Partial<{
    name: string;
    description: string;
    descriptionBrief: string;
    summary: string;
    startDate: string;
    endDate: string;
    url: string;
    contact: string;
    contactAuthorForMore: boolean;
    price: string;
    venue: string;
    address: string;
    city: string;
    tags: string[];
    emojis: string;
}>

// used in google studio to generate a json schema for the answer
export const MsgAnalysisAnswerOpenApiSchema = {
    "type": "object",
    "properties": {
        "hasEventData": {
            "type": "boolean"
        },
        "name": {
            "type": "string"
        },
        "description": {
            "type": "string"
        },
        "descriptionBrief": {
            "type": "string"
        },
        "summary": {
            "type": "string"
        },
        "startDate": {
            "type": "string",
            "format": "date-time"
        },
        "endDate": {
            "type": "string",
            "format": "date-time"
        },
        "url": {
            "type": "string",
            "format": "uri"
        },
        "contact": {
            "type": "string"
        },
        "contactAuthorForMore": {
            "type": "boolean"
        },
        "price": {
            "type": "string"
        },
        "venue": {
            "type": "string"
        },
        "address": {
            "type": "string"
        },
        "city": {
            "type": "string"
        },
        "tags": {
            "type": "array",
            "items": {
                "type": "string"
            }
        },
        "emojis": {
            "type": "string"
        }
    },
    "required": ["hasEventData"]
}
