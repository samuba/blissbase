import { CLOUDINARY_API_KEY, CLOUDINARY_CLOUD_NAME, GOOGLE_MAPS_API_KEY, CLOUDINARY_API_SECRET } from '$env/static/private';
import type { Context } from 'telegraf';
import { } from 'telegraf/filters';
import { generateSlug, parseTelegramContact } from '$lib/common';
import { geocodeAddressCached } from '$lib/server/google';
import { insertEvents } from '$lib/server/events';
import type { InsertEvent } from '$lib/types';
import { db, eq, s, sql } from '$lib/server/db';
import type { TelegramCloudflareBody } from '$lib/telegramCommon';
import { routes } from '$lib/routes';
import { calculatePhash, resizeCoverImage } from '$lib/imageProcessing';
import { randomString } from '$lib/common';
import { uploadImage } from '$lib/cloudinary';

const cloudinaryCreds = {
    apiKey: CLOUDINARY_API_KEY,
    apiSecret: CLOUDINARY_API_SECRET,
    cloudName: CLOUDINARY_CLOUD_NAME
}

export async function handleMessage(ctx: Context, { aiAnswer, msgTextHtml, image, fromGroup }: TelegramCloudflareBody) {
    if (!msgTextHtml.trim()) return

    const isAdmin = ctx.from?.id === 218154725;

    console.log({ fromGroup, aiAnswer, isAdmin })

    const msgId = await recordMessage(ctx)
    try {
        if (aiAnswer.existingSource) {
            console.log("event from existing source", msgTextHtml)
            await reply(ctx, `👯 Es sieht aus als ob dieser Event bereits auf ${aiAnswer.existingSource} existiert.\nWir fügen regelmäßig alle events von ${aiAnswer.existingSource} zu Blissbase hinzu. Du musst uns diese Events also nicht schicken. 😉`, fromGroup, msgId)
            return
        }
        if (!aiAnswer.hasEventData) {
            console.log("No event data found", msgTextHtml)
            await reply(ctx, "🙅🏻‍♂️🎫 Aus dieser Nachricht konnte ich keine Eventdaten extrahieren. Bitte schicke mir eine Event Beschreibung/Ankündigung.", fromGroup, msgId)
            return
        }
        if (!aiAnswer.name) {
            console.log("No event name found", msgTextHtml)
            await reply(ctx, "🙅🏻‍♂️🪧 Aus dieser Nachricht konnte ich keinen eindeutigen Titel für den Event extrahieren", fromGroup, msgId)
            return
        }
        if (!aiAnswer.startDate) {
            console.log("No event start date found", msgTextHtml)
            await reply(ctx, "🙅🏻‍♂️📅 Aus dieser Nachricht konnte ich keine Startzeit für den Event extrahieren", fromGroup, msgId)
            return
        }
        if (!aiAnswer.address && !aiAnswer.venue && !aiAnswer.city) {
            const chatConfig = await db.query.telegramChatConfig.findFirst({ where: eq(s.telegramChatConfig.chatId, BigInt(ctx.chat?.id ?? 0)) })
            if (chatConfig?.defaultAddress) {
                aiAnswer.address = chatConfig.defaultAddress.join(',')
            } else {
                console.log("No event location found", msgTextHtml)
                await reply(ctx, "🙅🏻‍♂️📍 Aus dieser Nachricht konnte ich keinen Ort für den Event extrahieren. Bitte gebe immer einen Ort an.", fromGroup, msgId)
                return
            }
        }

        let addressArr = aiAnswer.address ? aiAnswer.address.split(',') : [];
        if (aiAnswer.venue && !aiAnswer.address?.includes(aiAnswer.venue)) addressArr = [aiAnswer.venue, ...addressArr];
        if (aiAnswer.city && !aiAnswer.address?.includes(aiAnswer.city)) addressArr = [...addressArr, aiAnswer.city];

        const coords = await geocodeAddressCached(addressArr, GOOGLE_MAPS_API_KEY || '')
        let contact = parseTelegramContact(aiAnswer.contact);
        const telegramAuthor = getTelegramEventOriginalAuthor(ctx.message)
        if (aiAnswer.contactAuthorForMore) {
            contact = telegramAuthor?.link
            if (!contact) {
                await reply(ctx, "⚠️ In deiner Nachricht forderst du Teilnehmer auf sich bei dir per Telegram zu melden, allerdings hast du in deinem Profil keinen Telegram Username eingetragen.\n\nBitte lege erst einen Telegram Username fest damit dich Teilnehmer per Telegram Link erreichen können. Danach kannst du mir die Nachricht erneut senden.", fromGroup, msgId)
                return
            }
        }


        const startAt = new Date(aiAnswer.startDate)
        const endAt = aiAnswer.endDate ? new Date(aiAnswer.endDate) : null
        const name = aiAnswer.name.trim()
        const slug = generateSlug({ name: aiAnswer.name, startAt, endAt: endAt ?? undefined })

        let imageUrl: string | undefined;
        if (image) {
            try {
                const startTime = performance.now();
                const res = await fetch(image.url)
                if (!res.ok) {
                    throw new Error("could not download image " + imageUrl + " " + res.statusText + " " + await res.text())
                }
                const resizedBuffer = await resizeCoverImage(await res.bytes())
                const hash = await calculatePhash(resizedBuffer)
                const uploadedImage = await uploadImage(resizedBuffer, slug, hash, cloudinaryCreds)
                imageUrl = uploadedImage.secure_url
                console.log(`image processing took: ${performance.now() - startTime}ms`);
            } catch (error) {
                console.error("error processing image", error)
            }
        }

        const eventRow: InsertEvent = {
            name,
            imageUrls: imageUrl ? [imageUrl] : [],
            startAt,
            endAt,
            address: addressArr,
            tags: aiAnswer.tags,
            latitude: coords?.lat,
            longitude: coords?.lng,
            price: aiAnswer.price,
            description: aiAnswer.description,
            descriptionOriginal: msgTextHtml,
            host: telegramAuthor?.name,
            hostLink: telegramAuthor?.link,
            sourceUrl: aiAnswer.url,
            messageSenderId: getTelegramSenderId(ctx.message),
            contact,
            source: "telegram",
            slug,
        } satisfies InsertEvent

        let skippedImage = false;
        const existingEvent = await db.query.events.findFirst({ where: eq(s.events.slug, eventRow.slug) });
        if (existingEvent) {
            if (ctx.chat?.type === 'private') {
                // assert its the same user that created the event
                if (existingEvent.messageSenderId !== getTelegramSenderId(ctx.message)) {
                    console.log("not the same user that created the event, not updating description for ", eventRow.slug, `user trying: ${getTelegramSenderId(ctx.message)}, original: ${existingEvent.messageSenderId}`)
                    await reply(ctx, "🙅🏻‍♂️🔐 Dieser Event existiert schon und du hast ihn nicht erstellt. Deshalb kannst du ihn auch nicht bearbeiten.", fromGroup, msgId)
                    return
                }
            } else {
                // group message, could be an update to the event
                // only override description if its longer than the existing one
                if ((existingEvent.description?.length ?? 0) > (eventRow.description?.length ?? 0)) {
                    console.log("existing description is longer than new one, not updating description for ", eventRow.slug)
                    eventRow.description = existingEvent.description ?? undefined
                }
            }

            // if no image was provided, use the existing one
            if ((eventRow.imageUrls?.length ?? 0) === 0 && (existingEvent.imageUrls?.length ?? 0) > 0) {
                eventRow.imageUrls = existingEvent.imageUrls ?? []
                skippedImage = true;
            }
        }

        eventRow.hostSecret = existingEvent?.hostSecret ?? (ctx.chat?.type === 'private' ? randomString(10) : undefined)

        console.log({ eventRow })

        let dbEvent;
        try {
            dbEvent = (await insertEvents([eventRow]))[0];
            if (!dbEvent) {
                throw new Error('Failed to create event in database');
            }
        } catch (error) {
            console.error('Error inserting event:', error);
            await reply(ctx, "⚠️ Fehler beim Speichern des Events. Bitte versuche es später erneut.", fromGroup, msgId);
            return;
        }

        await ctx.react('⚡', false) // marker that the event was transferred

        const adminLinkText = `
⚠️ Link zum bearbeiten des Events:
<a href="${routes.editEvent(dbEvent.id, eventRow.hostSecret!, true)}">Admin Link (nicht teilen)</a>
ACHTUNG: Jeder mit dem Admin Link kann den Event bearbeiten oder löschen!!
        `.trim()

        if (existingEvent) {
            await reply(ctx, `
✅ Der Event wurde aktualisiert:
<a href="${routes.eventDetails(dbEvent.slug, true)}">Link zu deinem Event</a>
${skippedImage ? "ℹ️ Du hast kein Bild angegeben, daher wurde das bestehende Bild beibehalten." : ""}
\n${adminLinkText}
`.trim(), fromGroup, msgId)
        } else {
            await reply(ctx, `
✅ Der Event wurde in Blissbase eingetragen. Teile den Link mit deinen Teilnehmern:
<a href="${routes.eventDetails(dbEvent.slug, true)}">Link zu deinem Event</a>
\n\n${adminLinkText}.
`.trim(), fromGroup, msgId)
        }
    } catch (error) {
        console.error(error)
        try {
            await reply(ctx, "⚠️ Die Nachricht konnte nicht verarbeitet werden versuche es später erneut.\n\nFehler: " + error, fromGroup, msgId)
        } catch { /* ignore */ }
    }
}

async function reply(ctx: Context, text: string, fromGroup: boolean, msgId: string | undefined) {
    if (!fromGroup) { // never reply in groups
        const replyOptions = ctx.message?.message_id
            ? { reply_parameters: { message_id: ctx.message.message_id } }
            : undefined;
        await ctx.replyWithHTML(text, replyOptions)
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
        const msg = message as unknown as {
            forward_from?: { username?: string; first_name?: string; last_name?: string };
            forward_origin?: {
                chat?: { username?: string; first_name?: string; last_name?: string };
                sender_user?: { username?: string; first_name?: string; last_name?: string };
                author_signature?: string;
            };
        };
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
        link: username ? `tg://resolve?domain=${username}` : undefined
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
