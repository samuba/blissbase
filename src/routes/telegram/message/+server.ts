import type { RequestHandler } from '@sveltejs/kit';
import { TELEGRAM_BOT_TOKEN, GOOGLE_MAPS_API_KEY } from '$env/static/private';
import { Context, Telegraf } from 'telegraf';
import { anyOf, message } from 'telegraf/filters';
import type { MessageEntity } from 'telegraf/types';
import { aiExtractEventData } from './ai';
import { sleep } from '$lib/common';
import { geocodeAddressCached } from '$lib/server/google';
import { insertEvent } from '$lib/server/db';
import type { InsertEvent } from '$lib/types';


const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

bot.on(anyOf(message('text'), message('forward_origin')), async (ctx) => {
    const isGroup =
        ctx.message?.chat.type === "group" || ctx.message?.chat.type === "supergroup"
    try {
        console.log("message received", ctx.message)

        let msgText = "";
        let msgEntities: MessageEntity[] = [];
        let imageUrl: string | undefined;

        if ('text' in ctx.message) {
            msgText = ctx.message.text;
            msgEntities = ctx.message.entities ?? [];
        } else if ('caption' in ctx.message && ctx.message.caption) {
            msgText = ctx.message.caption;
            msgEntities = ctx.message.caption_entities ?? [];
        }

        if ('photo' in ctx.message) {
            const images = ctx.message.photo;
            if (images && images.length > 0) {
                // Typically, the last photo in the array is the largest
                const largestPhoto = images[images.length - 2];
                const fileLink = await ctx.telegram.getFileLink(largestPhoto.file_id);
                imageUrl = fileLink.href;
            }
        }
        const msgTextHtml = resolveTelegramFormattingToHtml(msgText, [...msgEntities])

        const aiAnswer = await wrapInTyping(ctx, () => aiExtractEventData(msgTextHtml), !isGroup)
        if (!aiAnswer.hasEventData) {
            await ctx.reply("Aus dieser Nachricht konnte ich keine Eventdaten extrahieren")
            return
        }
        if (!aiAnswer.name) {
            await ctx.reply("Aus dieser Nachricht konnte ich keinen Titel für den Event extrahieren")
            return
        }
        if (!aiAnswer.startDate) {
            await ctx.reply("Aus dieser Nachricht konnte ich keine Startzeit für den Event extrahieren")
            return
        }

        const addressArr = [aiAnswer.venue, aiAnswer.address ?? aiAnswer.city].filter(x => x?.trim())
        const coords = await geocodeAddressCached(addressArr, GOOGLE_MAPS_API_KEY || '')
        const contact = aiAnswer.contactAuthorForMore ? getTelegramLinkToOriginalAuthor(ctx) : aiAnswer.contact;
        const dbEntry = {
            name: aiAnswer.name,
            imageUrls: imageUrl ? [imageUrl] : [],
            startAt: new Date(aiAnswer.startDate),
            endAt: aiAnswer.endDate ? new Date(aiAnswer.endDate) : null,
            address: addressArr,
            tags: aiAnswer.tags,
            latitude: coords?.lat,
            longitude: coords?.lng,
            price: aiAnswer.price,
            description: aiAnswer.description,
            sourceUrl: aiAnswer.url,
            contact: aiAnswer.contactAuthorForMore ? aiAnswer.contact : undefined,
            source: "telegram",
        } satisfies InsertEvent

        console.log({ dbEntry })

        await insertEvent(dbEntry)

        if (isGroup) return; // dont answer in groups

        await ctx.reply(JSON.stringify({ ...aiAnswer, imageUrl, coords, permalink: aiAnswer.url, contact }, null, 2))
        await ctx.reply("Der Event wurde erfolgreich erstellt")

    } catch (error) {
        console.error(error)
        try {
            if (!isGroup) {
                await ctx.reply("⚠️ Die Nachricht konnte nicht verarbeitet werden versuche es später erneut.\n\nFehler: " + error)
            }
        } catch { /* ignore */ }
    }
})

export const POST: RequestHandler = async ({ request }) => {
    try {
        const data = await request.json();
        bot.handleUpdate(data)
    } catch (error) {
        console.error(error);
    }

    return new Response('OK', { status: 200 });
};


function getTelegramLinkToOriginalAuthor(ctx: Context): string | undefined {
    // Check if the message is a forwarded message and has 'forward_from' (user)
    if (
        ctx.message &&
        'forward_from' in ctx.message &&
        ctx.message.forward_from && // Ensure it's not null/undefined
        typeof ctx.message.forward_from === 'object' && // Ensure it's an object
        'id' in ctx.message.forward_from &&
        ctx.message.forward_from.id // Ensure id is present and truthy (though id is a number)
    ) {
        const originalAuthorId = ctx.message.forward_from.id;
        return `tg://user?id=${originalAuthorId}`;
    }
    // If forwarded from a channel ('forward_from_chat'), we could link to the channel,
    // but the request is for the *author*.
    // If 'forward_sender_name' is present, the user hid their account, so no direct ID link.
    return undefined;
}

async function wrapInTyping<T>(ctx: Context, fn: () => Promise<T>, enabled: boolean) {
    if (!enabled) return fn();

    const typingControl = new AbortController();
    const typingPromise = sendTypingPeriodically(ctx, typingControl.signal);
    try {
        return await fn();
    } finally {
        typingControl.abort();
        await typingPromise.catch(() => { }); // Wait for the typing interval to stop
    }
}

async function sendTypingPeriodically(ctx: Context, signal: AbortSignal) {
    while (!signal.aborted) {
        await ctx.sendChatAction('typing');
        await sleep(5000); // 5 seconds
    }
}

function resolveTelegramFormattingToHtml(text: string, entities: MessageEntity[]) {
    let result = text;

    // Sort entities by offset in descending order to process them from end to start. This prevents offset issues when inserting HTML tags
    entities.sort((a, b) => b.offset - a.offset);

    for (const entity of entities) {
        const { offset, length, type } = entity;
        // Get the content before any HTML tags are inserted
        const content = text.slice(offset, offset + length);

        switch (type) {
            case "bold":
                result = result.slice(0, offset) + `<b>${content}</b>` + result.slice(offset + length);
                break;
            case "italic":
                result = result.slice(0, offset) + `<i>${content}</i>` + result.slice(offset + length);
                break;
            case "underline":
                result = result.slice(0, offset) + `<u>${content}</u>` + result.slice(offset + length);
                break;
            case "strikethrough":
                result = result.slice(0, offset) + `<s>${content}</s>` + result.slice(offset + length);
                break;
            case "code":
                result = result.slice(0, offset) + `<code>${content}</code>` + result.slice(offset + length);
                break;
            case "pre":
                result = result.slice(0, offset) + `<pre>${content}</pre>` + result.slice(offset + length);
                break;
            case "text_link":
                result = result.slice(0, offset) + `<a href="${entity.url}">${content}</a>` + result.slice(offset + length);
                break;
            case "text_mention":
                result = result.slice(0, offset) + `<a href="tg://user?id=${entity.user?.id}">${content}</a>` + result.slice(offset + length);
                break;
            case "mention":
                result = result.slice(0, offset) + `<a href="tg://user?id=${content.slice(1)}">${content}</a>` + result.slice(offset + length);
                break;
            case "hashtag":
                result = result.slice(0, offset) + `<a href="tg://search?query=${encodeURIComponent(content)}">${content}</a>` + result.slice(offset + length);
                break;
            case "cashtag":
                result = result.slice(0, offset) + `<a href="tg://search?query=${encodeURIComponent(content)}">${content}</a>` + result.slice(offset + length);
                break;
            case "bot_command":
                result = result.slice(0, offset) + `<code>${content}</code>` + result.slice(offset + length);
                break;
            case "url":
                result = result.slice(0, offset) + `<a href="${content}">${content}</a>` + result.slice(offset + length);
                break;
            case "email":
                result = result.slice(0, offset) + `<a href="mailto:${content}">${content}</a>` + result.slice(offset + length);
                break;
            case "phone_number":
                result = result.slice(0, offset) + `<a href="tel:${content}">${content}</a>` + result.slice(offset + length);
                break;
            case "spoiler":
                result = result.slice(0, offset) + `<span class="tg-spoiler">${content}</span>` + result.slice(offset + length);
                break;
            case "blockquote":
                result = result.slice(0, offset) + `<blockquote>${content}</blockquote>` + result.slice(offset + length);
                break;
        }
    }

    result = result.replace(/\n/g, "<br>")

    return result;
}