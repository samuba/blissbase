import { GOOGLE_MAPS_API_KEY } from '$env/static/private';
import type { Context } from 'telegraf';
import { } from 'telegraf/filters';
import { cachedImageUrl } from '$lib/common';
import { geocodeAddressCached } from '$lib/server/google';
import { insertEvents } from '$lib/server/events';
import type { InsertEvent } from '$lib/types';
import { db, eq, s, sql } from '$lib/server/db';
import type { TelegramCloudflareBody } from '$lib/telegramCommon';

export async function handleMessage(ctx: Context, { aiAnswer, msgTextHtml, imageUrl, fromGroup }: TelegramCloudflareBody) {
    if (!msgTextHtml.trim()) return

    const isAdmin = ctx.from?.id === 218154725;

    console.log({ fromGroup, aiAnswer, isAdmin })

    const msgId = await recordMessage(ctx)
    try {
        if (aiAnswer.existingSource) {
            console.log("event from existing source", msgTextHtml)
            await reply(ctx, `Es sieht aus als ob dieser Event bereits auf ${aiAnswer.existingSource} existiert.\nWir fügen regelmäßig alle events von ${aiAnswer.existingSource} zu BlissBase hinzu. Du musst uns diese Events also nicht schicken. 😉`, fromGroup, msgId)
            return
        }
        if (!aiAnswer.hasEventData) {
            console.log("No event data found", msgTextHtml)
            await reply(ctx, "Aus dieser Nachricht konnte ich keine Eventdaten extrahieren. Bitte schicke mir eine Event Beschreibung/Ankündigung.", fromGroup, msgId)
            return
        }
        if (!aiAnswer.name) {
            console.log("No event name found", msgTextHtml)
            await reply(ctx, "Aus dieser Nachricht konnte ich keinen Titel für den Event extrahieren", fromGroup, msgId)
            return
        }
        if (!aiAnswer.startDate) {
            console.log("No event start date found", msgTextHtml)
            await reply(ctx, "Aus dieser Nachricht konnte ich keine Startzeit für den Event extrahieren", fromGroup, msgId)
            return
        }
        if (!aiAnswer.address && !aiAnswer.venue && !aiAnswer.city) {
            console.log("No event location found", msgTextHtml)
            await reply(ctx, "Aus dieser Nachricht konnte ich keinen Ort für den Event extrahieren. Bitte gebe immer einen Ort an.", fromGroup, msgId)
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
                await reply(ctx, "⚠️ In deiner Nachricht forderst du Teilnehmer auf sich bei dir per Telegram zu melden, allerdings hast du in deinem Profil keinen Telegram Username eingetragen.\n\nBitte lege erst einen Telegram Username fest damit dich Teilnehmer per Telegram Link erreichen können. Danach kannst du mir die Nachricht erneut senden.", fromGroup, msgId)
                return
            }
        }

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

        const dbEvent = (await insertEvents([dbEntry]))[0]

        await reply(ctx, "✅ Der Event wurde in BlissBase eingetragen:\n\nhttps://blissbase.app/" + dbEvent.slug, fromGroup, msgId)
    } catch (error) {
        console.error(error)
        try {
            await reply(ctx, "⚠️ Die Nachricht konnte nicht verarbeitet werden versuche es später erneut.\n\nFehler: " + error, fromGroup, msgId)
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

async function reply(ctx: Context, text: string, fromGroup: boolean, msgId: string | undefined) {
    if (!fromGroup) { // never reply in groups
        const replyOptions = ctx.message?.message_id
            ? { reply_parameters: { message_id: ctx.message.message_id } }
            : undefined;
        await ctx.reply(text, replyOptions)
    }

    if (msgId) {
        const msg = fromGroup ? `hidden: ${text}` : text;
        await db.update(s.botMessages)
            .set({ answer: sql`COALESCE(answer || E'\n\n', '') || ${msg}` })
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

async function recordMessage(ctx: Context) {
    if (!ctx.message && !ctx.channelPost) return;

    try {
        const row = await db.insert(s.botMessages).values({ data: ctx.message ?? ctx.channelPost }).returning()
        return row![0].id
    } catch (error) {
        console.error("error recording telegram message", error)
    }
}