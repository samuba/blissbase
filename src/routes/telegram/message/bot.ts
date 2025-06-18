import { TELEGRAM_BOT_TOKEN, GOOGLE_MAPS_API_KEY } from '$env/static/private';
import { Context, Telegraf, Composer } from 'telegraf';
import { anyOf, message } from 'telegraf/filters';
import type { MessageEntity } from 'telegraf/types';
import { aiExtractEventData, type MsgAnalysisAnswer } from './ai';
import { cachedImageUrl, sleep } from '$lib/common';
import { geocodeAddressCached } from '$lib/server/google';
import { insertEvent } from '$lib/server/events';
import type { InsertEvent } from '$lib/types';
import { db, eq, s, sql } from '$lib/server/db';

export const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

export const messageFilters = anyOf(message('text'), message('forward_origin'))

export async function handleMessage(ctx: Context, { aiAnswer }: { aiAnswer: MsgAnalysisAnswer }) {
    console.log("message received", ctx.message);


    const isGroup =
        ctx.message?.chat.type === "group" || ctx.message?.chat.type === "supergroup"


    console.log({ isGroup, aiAnswer })

    return
    const msgId = await recordMessage(ctx.message)
    try {
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
            console.log("No event data found", msgText)
            await reply(ctx, "Aus dieser Nachricht konnte ich keine Eventdaten extrahieren. Bitte schicke mir eine Event Beschreibung/Ankündigung.", msgId)
            return
        }
        if (!aiAnswer.name) {
            console.log("No event name found", msgText)
            await reply(ctx, "Aus dieser Nachricht konnte ich keinen Titel für den Event extrahieren", msgId)
            return
        }
        if (!aiAnswer.startDate) {
            console.log("No event start date found", msgText)
            await reply(ctx, "Aus dieser Nachricht konnte ich keine Startzeit für den Event extrahieren", msgId)
            return
        }
        if (!aiAnswer.address && !aiAnswer.venue && !aiAnswer.city) {
            console.log("No event location found", msgText)
            await reply(ctx, "Aus dieser Nachricht konnte ich keinen Ort für den Event extrahieren. Bitte gebe immer einen Ort an.", msgId)
            return
        }

        if (imageUrl) {
            // transfer image 
            const startTime = performance.now();
            const res = await fetch(cachedImageUrl(imageUrl)!, { method: 'HEAD' })
            if (res.ok) {
                imageUrl = cachedImageUrl(imageUrl)
            }
            const endTime = performance.now();
            console.log(`image processing took: ${endTime - startTime}ms`);
        }

        let addressArr = aiAnswer.address ? [aiAnswer.address] : [];
        if (aiAnswer.venue && !aiAnswer.address?.includes(aiAnswer.venue)) addressArr = [aiAnswer.venue, ...addressArr];
        if (aiAnswer.city && !aiAnswer.address?.includes(aiAnswer.city)) addressArr = [...addressArr, aiAnswer.city];

        const coords = await geocodeAddressCached(addressArr, GOOGLE_MAPS_API_KEY || '')
        let contact = parseContact(aiAnswer.contact);
        const telegramAuthor = getTelegramEventOriginalAuthor(ctx.message)
        if (aiAnswer.contactAuthorForMore) {
            contact = telegramAuthor?.link
            if (!contact) {
                await reply(ctx, "⚠️ In deiner Nachricht forderst du Teilnehmer auf sich bei dir per Telegram zu melden, allerdings hast du in deinem Profil keinen Telegram Username eingetragen.\n\nBitte lege erst einen Telegram Username fest damit dich Teilnehmer per Telegram Link erreichen können. Danach kannst du mir die Nachricht erneut senden.", msgId)
                return
            }
        }
        console.log({ contact })
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
            description: aiAnswer.descriptionBrief,
            descriptionOriginal: msgTextHtml,
            summary: aiAnswer.summary,
            host: telegramAuthor?.name,
            hostLink: telegramAuthor?.link,
            sourceUrl: aiAnswer.url,
            messageSenderId: getTelegramSenderId(ctx.message),
            contact,
            source: "telegram",
            slug: "",
        } satisfies InsertEvent

        console.log({ dbEntry })

        const dbEvent = await insertEvent(dbEntry)

        if (isGroup) return; // dont answer in groups

        await reply(ctx, JSON.stringify({
            ...aiAnswer,
            descriptionBrief: aiAnswer.descriptionBrief?.slice(0, 50),
            description: aiAnswer.description?.slice(0, 50),
            imageUrl,
            coords,
            sourceUrl: aiAnswer.url,
            contact
        }, null, 2), msgId)
        await reply(ctx, "Der Event wurde erfolgreich in BlissBase eingetragen.\nDu findest ihn hier: https://blissbase.app/" + dbEvent.slug, msgId)

    } catch (error) {
        console.error(error)
        try {
            if (!isGroup) {
                await reply(ctx, "⚠️ Die Nachricht konnte nicht verarbeitet werden versuche es später erneut.\n\nFehler: " + error, msgId)
            }
        } catch { /* ignore */ }
    }
}


function parseContact(contact: string | undefined) {
    if (!contact?.trim()) return undefined;

    if (contact.startsWith('https://t.me/')) {
        //https://t.me/MagdalenaHSC",
        return `tg://resolve?domain=${contact.slice(14)}`
    }
    if (contact.startsWith('https://t.me/')) {
        //t.me/MagdalenaHSC",
        return `tg://resolve?domain=${contact.slice(6)}`
    }
    if (contact.startsWith('@')) {
        return `tg://resolve?domain=${contact.slice(1)}`
    }
    if (contact.startsWith('+')) {
        return `tel:${contact}`
    }
    if (contact.startsWith('http')) {
        return contact
    }
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
        return `mailto:${contact}`
    }
    return contact;
}

async function reply(ctx: Context, text: string, msgId: string | undefined) {
    if (ctx.message?.chat.type === "group" || ctx.message?.chat.type === "supergroup") {
        return // do not reply in groups
    }
    await ctx.reply(text)
    if (msgId) {
        await db.update(s.botMessages)
            .set({ answer: sql`COALESCE(answer || E'\n\n', '') || ${text}` })
            .where(eq(s.botMessages.id, msgId))
    }
}

function wasMessageForwarded(message: Context['message']): boolean {
    if (!message) return false;
    return 'forward_from' in message || 'forward_origin' in message;
}

function getTelegramSenderId(message: Context['message']): string | undefined {
    if (!message) return undefined;
    return message.from.id?.toString();
}

function getTelegramEventOriginalAuthor(message: Context['message']) {
    if (!message) return undefined;

    let username: string | undefined;
    let firstName: string | undefined;
    let lastName: string | undefined;

    if (wasMessageForwarded(message)) {
        const msg = message as any;
        username = msg?.forward_from?.username ??
            msg.forward_origin?.chat?.username ??
            msg.forward_origin?.sender_user?.username
        firstName = msg?.forward_from?.first_name ??
            msg.forward_origin?.author_signature ?? // might be full name but screw it
            msg.forward_origin?.chat?.first_name ??
            msg.forward_origin?.sender_user?.first_name
        lastName = msg?.forward_from?.last_name ??
            msg.forward_origin?.chat?.last_name ??
            msg.forward_origin?.sender_user?.last_name
    } else {
        firstName = message?.from.first_name;
        lastName = message?.from.last_name;
        username = message?.from.username;
    }

    console.log({ username, firstName, lastName })

    let name: string | undefined;
    if (firstName && lastName && username) {
        name = `${firstName} ${lastName} (@${username})`;
    } else if (firstName && lastName) {
        name = `${firstName} ${lastName}`;
    } else if (firstName && username) {
        name = `${firstName} (@${username})`;
    } else if (firstName) {
        name = firstName;
    } else if (username) {
        name = username;
    }
    return {
        name,
        id: message?.from.id,
        link: username ? `https://t.me/${username}` : undefined
    };
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

async function recordMessage(message: Context['message']) {
    if (!message) return;

    try {
        const row = await db.insert(s.botMessages).values({ data: message }).returning()
        return row![0].id
    } catch (error) {
        console.error("error recording telegram message", error)
    }
}

function resolveTelegramFormattingToHtml(text: string, entities: MessageEntity[]) {
    function getOpeningTag(entity: MessageEntity, text: string): string {
        const content = text.slice(entity.offset, entity.offset + entity.length);

        switch (entity.type) {
            case "bold":
                return '<b>';
            case "italic":
                return '<i>';
            case "underline":
                return '<u>';
            case "strikethrough":
                return '<s>';
            case "code":
                return '<code>';
            case "pre":
                return '<pre>';
            case "text_link":
                return `<a href="${entity.url}">`;
            case "text_mention":
                return `<a href="tg://user?id=${entity.user?.id}">`;
            case "mention":
                return `<a href="tg://user?id=${content.slice(1)}">`;
            case "hashtag":
                return `<a href="tg://search?query=${encodeURIComponent(content)}">`;
            case "cashtag":
                return `<a href="tg://search?query=${encodeURIComponent(content)}">`;
            case "bot_command":
                return '<code>';
            case "url":
                return `<a href="${content}">`;
            case "email":
                return `<a href="mailto:${content}">`;
            case "phone_number":
                return `<a href="tel:${content}">`;
            case "spoiler":
                return '<span class="tg-spoiler">';
            case "blockquote":
                return '<blockquote>';
            default:
                return '';
        }
    }

    function getClosingTag(entity: MessageEntity): string {
        switch (entity.type) {
            case "bold":
                return '</b>';
            case "italic":
                return '</i>';
            case "underline":
                return '</u>';
            case "strikethrough":
                return '</s>';
            case "code":
            case "bot_command":
                return '</code>';
            case "pre":
                return '</pre>';
            case "text_link":
            case "text_mention":
            case "mention":
            case "hashtag":
            case "cashtag":
            case "url":
            case "email":
            case "phone_number":
                return '</a>';
            case "spoiler":
                return '</span>';
            case "blockquote":
                return '</blockquote>';
            default:
                return '';
        }
    }
    function lineBreaksToBr(text: string) {
        return text
            .replaceAll("\n", "<br>")
            .replace(/<br>(\s*<br>){2,}/g, '<br><br>') // Limit consecutive <br> tags to maximum 2, regardless of whitespace between them
    }


    if (!entities.length) {
        return lineBreaksToBr(text)
    }

    // Create a map of position -> formatting changes
    const formatChanges = new Map<number, { starts: MessageEntity[], ends: MessageEntity[] }>();

    for (const entity of entities) {
        // Start of entity
        if (!formatChanges.has(entity.offset)) {
            formatChanges.set(entity.offset, { starts: [], ends: [] });
        }
        formatChanges.get(entity.offset)!.starts.push(entity);

        // End of entity
        const endPos = entity.offset + entity.length;
        if (!formatChanges.has(endPos)) {
            formatChanges.set(endPos, { starts: [], ends: [] });
        }
        formatChanges.get(endPos)!.ends.push(entity);
    }

    let result = '';
    const activeEntities: MessageEntity[] = [];

    for (let i = 0; i <= text.length; i++) {
        // Handle formatting changes at this position
        const changes = formatChanges.get(i);
        if (changes) {
            // If any entities end at this position, we need to handle overlaps properly
            if (changes.ends.length > 0) {
                // Close all active entities in reverse opening order (LIFO)
                for (let j = activeEntities.length - 1; j >= 0; j--) {
                    result += getClosingTag(activeEntities[j]);
                }

                // Remove entities that actually end at this position
                const entitiesStillActive = activeEntities.filter(entity =>
                    !changes.ends.includes(entity)
                );

                // Reopen entities that are still active (in original opening order)
                for (const entity of entitiesStillActive) {
                    result += getOpeningTag(entity, text);
                }

                // Update active entities list
                activeEntities.length = 0;
                activeEntities.push(...entitiesStillActive);
            }

            // Open new entities starting at this position
            for (const entity of changes.starts) {
                activeEntities.push(entity);
                result += getOpeningTag(entity, text);
            }
        }

        // Add the character if we're not at the end
        if (i < text.length) {
            result += text[i];
        }
    }

    result = lineBreaksToBr(result)

    return result;
}