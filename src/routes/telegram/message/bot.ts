import { GOOGLE_MAPS_API_KEY, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET_NAME, CLOUDFLARE_ACCOUNT_ID } from '$env/static/private';
import type { Context } from 'telegraf';
import { } from 'telegraf/filters';
import { generateSlug, parseTelegramContacts } from '$lib/common';
import { geocodeAddressCached } from '$lib/server/google';
import { upsertEvents } from '$lib/server/events';
import type { InsertEvent } from '$lib/types';
import { db, eq, s, sql } from '$lib/server/db';
import { getTelegramEventOriginalAuthor, type TelegramCloudflareBody } from '$lib/telegramCommon';
import { absoluteUrl, routes } from '$lib/routes';
import { resizeCoverImage } from '$lib/imageProcessing';
import { randomString } from '$lib/common';
import { loadCreds, uploadEventImage } from '$lib/assets';
import { detectLanguage, t, type BotLanguage } from '$lib/telegramBotI18n';

const assetsCreds = loadCreds({ S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET_NAME, CLOUDFLARE_ACCOUNT_ID })

export async function handleMessage(ctx: Context, { aiAnswer, msgTextHtml, image, fromGroup }: TelegramCloudflareBody) {
    if (!msgTextHtml.trim()) return

    const isAdmin = ctx.from?.id === 218154725;
    const lang: BotLanguage = detectLanguage(ctx.from?.language_code);

    console.log({ fromGroup, aiAnswer, isAdmin, languageCode: ctx.from?.language_code, detectedLang: lang })

    const msgId = await recordMessage(ctx)
    try {
        if (aiAnswer.existingSource) {
            console.log("event from existing source", msgTextHtml)
            await reply(ctx, t.eventExistsOnSource(lang, aiAnswer.existingSource), fromGroup, msgId)
            return
        }
        if (!aiAnswer.hasEventData) {
            console.log("No event data found", msgTextHtml)
            await reply(ctx, t.noEventData(lang), fromGroup, msgId)
            return
        }
        if (!aiAnswer.name) {
            console.log("No event name found", msgTextHtml)
            await reply(ctx, t.noEventName(lang), fromGroup, msgId)
            return
        }
        if (!aiAnswer.startDate) {
            console.log("No event start date found", msgTextHtml)
            await reply(ctx, t.noStartDate(lang), fromGroup, msgId)
            return
        }
        if (aiAnswer.attendanceMode === "offline") {
            if (!aiAnswer.address && !aiAnswer.venue && !aiAnswer.city) {
                const chatConfig = await db.query.telegramChatConfig.findFirst({ where: eq(s.telegramChatConfig.chatId, BigInt(ctx.chat?.id ?? 0)) })
                if (chatConfig?.defaultAddress) {
                    aiAnswer.address = chatConfig.defaultAddress.join(',')
                } else {
                    console.log("No event location found", msgTextHtml)
                    await reply(ctx, t.noLocation(lang), fromGroup, msgId)
                    return
                }
            }
        }

        let addressArr = aiAnswer.address ? aiAnswer.address.split(',') : [];
        if (aiAnswer.venue && !aiAnswer.address?.includes(aiAnswer.venue)) addressArr = [aiAnswer.venue, ...addressArr];
        if (aiAnswer.city && !aiAnswer.address?.includes(aiAnswer.city)) addressArr = [...addressArr, aiAnswer.city];

        const coords = await geocodeAddressCached({
            addressLines: addressArr,
            apiKey: GOOGLE_MAPS_API_KEY || ``
        })
        const contact = parseTelegramContacts(aiAnswer.contact)
        const telegramAuthor = getTelegramEventOriginalAuthor(ctx.message)
        if (aiAnswer.contactAuthorForMore) {
            if (telegramAuthor?.link) contact.push(telegramAuthor.link)
            if (!contact.some(x => x?.startsWith('tg://'))) {
                await reply(ctx, t.noTelegramUsername(lang), fromGroup, msgId)
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
                const { buffer: resizedBuffer, phash: hash } = await resizeCoverImage(await res.bytes())
                imageUrl = await uploadEventImage(resizedBuffer, slug, hash, assetsCreds)
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
            timezone: coords?.timezone,
            price: aiAnswer.price,
            description: aiAnswer.description,
            descriptionOriginal: msgTextHtml,
            host: telegramAuthor?.name,
            hostLink: telegramAuthor?.link,
            sourceUrl: aiAnswer.url,
            attendanceMode: aiAnswer.attendanceMode,
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
                    await reply(ctx, t.notEventOwner(lang), fromGroup, msgId)
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
            dbEvent = (await upsertEvents([eventRow]))[0];
            if (!dbEvent) {
                throw new Error('Failed to create event in database');
            }
        } catch (error) {
            console.error('Error inserting event:', error);
            await reply(ctx, t.saveError(lang), fromGroup, msgId);
            return;
        }

        await ctx.react('⚡', false) // marker that the event was transferred

        const adminLinkText = t.adminLinkWarning(lang, absoluteUrl(routes.editEvent(dbEvent.id, eventRow.hostSecret!)));

        if (existingEvent) {
            const skippedImageMsg = skippedImage ? t.imageKept(lang) : "";
            await reply(ctx, t.eventUpdated(lang, absoluteUrl(routes.eventDetails(dbEvent.slug)), skippedImageMsg, adminLinkText), fromGroup, msgId)
        } else {
            await reply(ctx, t.eventCreated(lang, absoluteUrl(routes.eventDetails(dbEvent.slug)), adminLinkText), fromGroup, msgId)
        }
    } catch (error) {
        console.error(error)
        try {
            await reply(ctx, t.genericError(lang, String(error)), fromGroup, msgId)
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

function getTelegramSenderId(message: Context['message']): string | undefined {
    if (!message) return undefined;
    return message.from.id?.toString();
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
