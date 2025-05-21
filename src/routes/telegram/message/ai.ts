import { OPENAI_API_KEY } from "$env/static/private";

export async function aiExtractEventData(message: string): Promise<MsgAnalysisAnswer> {
    const { answer } = await promptAi<MsgAnalysisAnswer>(message, msgAnalysisSystemPrompt)
    return answer;
}

export async function promptAi<T>(message: string, systemPrompt: string = "") {
    const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
            "model": "o4-mini",
            "input": [
                {
                    "role": "developer",
                    "content": [
                        {
                            "type": "input_text",
                            "text": systemPrompt
                        }
                    ]
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": message
                        }
                    ]
                },
            ],
            "text": {
                "format": {
                    "type": "json_object"
                }
            },
            "reasoning": {
                "effort": "medium"
            },
            "tools": [],
            "store": true
        })
    });

    if (!response.ok) {
        throw new Error(`OpenAI API call failed: ${response.status}, ${response.statusText}, ${await response.text()}`);
    }

    const data = await response.json() as OpenAiResponse;
    const answer = data.output.find(o => o.type === "message" && o.status === 'completed')?.content?.[0]?.text;

    try {
        const parsedContent = JSON.parse(answer || '{ "hasEventData": false }') as T;
        return { ...data, answer: parsedContent };
    } catch (e) {
        throw new Error('Failed to parse OpenAI response as JSON:' + e.message);
    }
}

export const msgAnalysisSystemPrompt = `
Your purpose is to anaylze text messages and extract infos from them.
Answer only in valid, raw JSON. Do not wrap it inside markdown or anything else.
Do not explain anything.
If you can not find the information for a certain field do not return that field. Leave it out. 
Never make up any information. Only use the information provided in the message!
Do not remove html tags.

Extract the following information from the messages:

"hasEventData": boolean. wether or not the message contains information about an event.

"name": string. the name of the event. needs to be an exact copy from the message. if there is no name in the text create a short descriptive name with not much personality

"description": string. A exact copy from the message. Preserve line breaks using \n. Preserve emojis and other special characters. Do not include the name of the event at the start of the description.

"descriptionBrief": string. The same content as in "description" field but without the information that were extracted in other fields. E.g. if start date is extracted, do not include it.

"summary": string. Summarise what the event is about in one descriptive sentence. Always use same language as the message. Never mention name of the event. Never mention date or location. Always sound friendly and keep it about this event.

"startDate": string. The date and time of the event start, in ISO 8601 format.

"endDate": string. The date and time of the event end, in ISO 8601 format. ONLY if specified in the message.

"url": string. if the text contains a url that likely represents the event and has more information about it, insert it in this field. Never consider urls for this that start with "https://t.me".

"contact": string. If the text contains contact information like messenger handles, URLs, phonenumbers etc that could be used to contact the event host.

"contactAuthorForMore": boolean. Wether the message states to contact the sender/author of the message via messenger or phone to register/attend or get more information about the event. Only true if there is no other means of contact specified in the message. E.g. if there is a contact email specified, this should be false.

"price": string. The price or costs of the event for the guest. If the price information includes new lines do not extract the price.

"venue": string. Name of the location/venue where the event is taking place.

"address": string. The full address where the event is happening.

"city": string. Name of the city/town where the event is happening.

"tags": string[]. Tags that describe the event.

"emojis": string. Up to 3 emojis that describe the event.


`


export type MsgAnalysisAnswer = {
    hasEventData: boolean;
    name: string;
    description: string;
    descriptionBrief: string;
    summary: string;
    startDate: string;
    endDate?: string;
    url: string;
    contact?: string;
    contactAuthorForMore: boolean;
    price: string;
    venue: string;
    address: string;
    city: string;
    tags: string[];
    emojis: string;
}

interface OpenAiResponse {
    id: string
    object: string
    created_at: number
    status: string
    error: unknown
    incomplete_details: unknown
    instructions: unknown
    max_output_tokens: unknown
    model: string
    output: Array<{
        id: string
        type: string
        summary?: Array<unknown>
        status?: string
        content?: Array<{
            type: string
            annotations: Array<unknown>
            text: string
        }>
        role?: string
    }>
    parallel_tool_calls: boolean
    previous_response_id: unknown
    reasoning: {
        effort: string
        summary: unknown
    }
    service_tier: string
    store: boolean
    temperature: number
    text: {
        format: {
            type: string
        }
    }
    tool_choice: string
    tools: Array<unknown>
    top_p: number
    truncation: string
    usage: {
        input_tokens: number
        input_tokens_details: {
            cached_tokens: number
        }
        output_tokens: number
        output_tokens_details: {
            reasoning_tokens: number
        }
        total_tokens: number
    }
    user: unknown
    metadata: unknown
}