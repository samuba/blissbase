import { Database } from "bun:sqlite"
import { S3Client } from "@bradenmacdonald/s3-lite-client"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import "dotenv/config"
import { and, db, eq, s } from "../src/lib/server/db.script.ts"
import type { InsertEvent } from "../src/lib/types"
import type { AiImageInput, MsgAnalysisAnswer } from "../src/lib/server/ai"
import { aiExtractEventData } from "../src/lib/server/ai"
import { sleep, generateSlug } from "../src/lib/common"
import { geocodeAddressCached } from "../src/lib/server/google.script.ts"
import { resizeCoverImage } from "../src/lib/imageProcessing"
import type { WhatsappScrapingTarget } from "../src/lib/server/schema" 
import * as assets from "../src/lib/assets"
import { insertEvents } from "../src/lib/server/events.script.ts";

const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY!
const sqliteObjectKey = `whatsapp.sqlite`
const maxSecondsBetweenMessagesForSameEvent = 20 * 60
/** Max messages loaded on first scrape per chat (latest N by time). Incremental runs load all messages since the stored cursor. */
const initialMessagesPerChat = 50
const sqliteDownloadTimeoutMs = 20_000
const sqliteDownloadRetryCount = 3

/**
 * Loads the R2 creds used by the whatsapp2sqlite pipeline.
 * @example
 * const creds = loadWhatsapp2SqliteCreds()
 */
function loadWhatsapp2SqliteCreds() {
    return {
        accessKey: process.env.WHATSAPP2SQLITE_R2_ACCESS_KEY_ID!,
        secretKey: process.env.WHATSAPP2SQLITE_R2_SECRET_ACCESS_KEY!,
        bucket: process.env.WHATSAPP2SQLITE_R2_BUCKET_NAME!,
        endPoint: process.env.WHATSAPP2SQLITE_R2_ENDPOINT,
        region: `auto`
    }
}

/**
 * Returns true when the synced WhatsApp row points at an image attachment.
 * @example
 * isImageMessage({ mediaMimeType: `image/jpeg`, mediaType: null } as WhatsappSyncMessage)
 */
function isImageMessage(message: WhatsappSyncMessage) {
    if (message.mediaMimeType?.startsWith(`image/`)) return true
    if (message.mediaType?.toLowerCase().includes(`image`)) return true
    if (message.messageType?.toLowerCase().includes(`image`)) return true
    return false
}

/**
 * Builds the sender metadata used for host/contact fields.
 * @example
 * getWhatsappAuthor({ senderJid: `123@s.whatsapp.net`, senderPhoneNumber: `49123`, pushName: `Sam` } as WhatsappSyncMessage)
 */
function getWhatsappAuthor(message: WhatsappSyncMessage): WhatsappAuthor {
    const normalizedPhone = normalizePhoneDigits(message.senderPhoneNumber)
    const link = normalizedPhone ? `https://wa.me/${normalizedPhone}` : undefined
    return {
        id: message.senderJid,
        name: message.pushName?.trim() || message.senderPhoneNumber?.trim() || message.senderJid,
        link,
        phoneNumber: normalizedPhone
    }
}

/**
 * Normalizes a phone number to WhatsApp-compatible digits.
 * @example
 * normalizePhoneDigits(`+49 123 456`)
 */
function normalizePhoneDigits(phone: string | null | undefined) {
    if (!phone?.trim()) return undefined
    const digits = phone.replace(/\D/g, ``)
    if (!digits.length) return undefined
    return digits
}

/**
 * Normalizes AI-extracted contacts into app-supported contact links.
 * @example
 * normalizeWhatsappContacts([`hello@example.com`, `+49 123 456`, `wa.me/49123`])
 */
function normalizeWhatsappContacts(contacts: string[] | undefined) {
    if (!contacts?.length) return []

    return Array.from(new Set(contacts.map((contact) => {
        if (!contact?.trim()) return undefined
        const trimmed = contact.trim()

        if (trimmed.startsWith(`https://wa.me/`)) return trimmed
        if (trimmed.startsWith(`wa.me/`)) return `https://${trimmed}`
        if (trimmed.startsWith(`https://api.whatsapp.com`)) return trimmed
        if (trimmed.startsWith(`api.whatsapp.com`)) return `https://${trimmed}`
        if (trimmed.startsWith(`mailto:`)) return trimmed
        if (trimmed.startsWith(`tel:`)) return trimmed
        if (trimmed.startsWith(`http`)) return trimmed
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return `mailto:${trimmed}`
        if (/^\+?\d[\d\s\-()]+\d$/.test(trimmed)) return `tel:${trimmed}`

        return trimmed
    }).filter((contact) => !!contact) as string[]))
}

/**
 * Downloads the latest WhatsApp SQLite snapshot from R2 into a temp file.
 * @example
 * const sqlitePath = await downloadWhatsappSqliteSnapshot()
 */
async function downloadWhatsappSqliteSnapshot() {
    console.log(`[whatsapp] Downloading SQLite snapshot from R2: ${sqliteObjectKey}`)
    const creds = loadWhatsapp2SqliteCreds()
    const s3 = new S3Client(creds)
    const snapshotPath = join(tmpdir(), `blissbase-whatsapp-${Date.now()}.sqlite`)

    for (let attempt = 1; attempt <= sqliteDownloadRetryCount; attempt++) {
        try {
            console.log(
                `[whatsapp] R2 download attempt ${attempt}/${sqliteDownloadRetryCount} for ${creds.bucket}/${sqliteObjectKey} (${sqliteDownloadTimeoutMs}ms timeout)`
            )
            const presignedUrl = await s3.getPresignedUrl(`GET`, sqliteObjectKey, { expirySeconds: 60 })
            const response = await fetch(presignedUrl, {
                signal: AbortSignal.timeout(sqliteDownloadTimeoutMs)
            })

            if (!response.ok) {
                const responseText = (await response.text()).trim()
                const truncatedResponseText = responseText.slice(0, 300)
                const responseSuffix = truncatedResponseText
                    ? `: ${truncatedResponseText}`
                    : ``
                throw new Error(`R2 download failed with ${response.status} ${response.statusText}${responseSuffix}`)
            }

            const bytes = new Uint8Array(await response.arrayBuffer())

            if (!bytes.length) {
                throw new Error(`R2 download returned an empty SQLite snapshot`)
            }

            await Bun.write(snapshotPath, bytes)
            console.log(`[whatsapp] Snapshot saved to temp file (${snapshotPath}, ${bytes.byteLength} bytes)`)
            return snapshotPath
        } catch (error) {
            const errorMessage = getErrorMessage(error)
            console.error(`[whatsapp] R2 download attempt ${attempt} failed: ${errorMessage}`)

            if (attempt === sqliteDownloadRetryCount) {
                throw new Error(
                    `Failed to download WhatsApp SQLite snapshot after ${sqliteDownloadRetryCount} attempts: ${errorMessage}`
                )
            }

            const retryDelayMs = Math.min(1_000 * attempt, 5_000)
            console.log(`[whatsapp] Retrying SQLite snapshot download in ${retryDelayMs}ms`)
            await sleep(retryDelayMs)
        }
    }

    throw new Error(`Failed to download WhatsApp SQLite snapshot`)
}

/**
 * Normalizes unknown thrown values into a readable error message.
 * @example
 * getErrorMessage(new Error(`boom`))
 */
function getErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message
    if (typeof error === `string`) return error
    return `Unknown error`
}

/**
 * Opens the downloaded WhatsApp SQLite database in readonly mode.
 * @example
 * const sqliteDb = openWhatsappSqlite(`/tmp/whatsapp.sqlite`)
 */
function openWhatsappSqlite(sqlitePath: string) {
    return new Database(sqlitePath, { readonly: true, create: false })
}

/**
 * Loads synced messages for a configured WhatsApp chat: latest N on first run, every message after the cursor otherwise.
 * @example
 * const messages = getMessagesForTarget({ sqliteDb, target })
 */
function getMessagesForTarget(args: { sqliteDb: Database; target: WhatsappScrapingTarget }) {
    const { sqliteDb, target } = args
    const params: Array<string | number> = [target.chatJid]
    let where = `chat_jid = ?`

    const lastTimestamp = target.lastMessageTimestamp
        ? Math.floor(new Date(target.lastMessageTimestamp).getTime() / 1000)
        : undefined

    if (lastTimestamp !== undefined) {
        // Always replay the cursor second so same-second messages cannot be skipped.
        where += ` AND timestamp >= ?`
        params.push(lastTimestamp)
    }

    const isFirstRunForChat = lastTimestamp === undefined
    const orderBy = isFirstRunForChat
        ? getWhatsappMessageOrderBySql({ descending: true })
        : getWhatsappMessageOrderBySql({ descending: false })
    const limitClause = isFirstRunForChat ? `LIMIT ?` : ``

    if (isFirstRunForChat) {
        params.push(initialMessagesPerChat)
    }

    const query = sqliteDb.query(`
        SELECT
            chat_jid AS chatJid,
            message_id AS messageId,
            sender_jid AS senderJid,
            sender_phone_number AS senderPhoneNumber,
            server_id AS serverId,
            timestamp,
            is_from_me AS isFromMe,
            is_group AS isGroup,
            push_name AS pushName,
            message_type AS messageType,
            category,
            media_type AS mediaType,
            media_mime_type AS mediaMimeType,
            media_path AS mediaPath,
            media_sha256 AS mediaSha256,
            text_value AS textValue,
            raw_message_json AS rawMessageJson,
            source_web_message_json AS sourceWebMessageJson,
            source,
            is_edit AS isEdit,
            is_ephemeral AS isEphemeral,
            is_view_once AS isViewOnce,
            updated_at AS updatedAt
        FROM sync_messages
        WHERE ${where}
        ORDER BY ${orderBy}
        ${limitClause}
    `)

    let rows = query.all(...params) as WhatsappSyncMessage[]
    if (isFirstRunForChat) {
        rows.reverse()
        return rows
    }

    rows = trimMessagesAfterCursor({
        messages: rows,
        lastTimestamp,
        lastMessageId: target.lastMessageId
    })
    return rows
}

/**
 * Returns the synced chat display name if present.
 * @example
 * const name = getChatName({ sqliteDb, chatJid: `123@g.us` })
 */
function getChatName(args: { sqliteDb: Database; chatJid: string }) {
    const row = args.sqliteDb.query(`
        SELECT COALESCE(display_name, username, chat_jid) AS name
        FROM sync_chats
        WHERE chat_jid = ?
    `).get(args.chatJid) as { name?: string } | undefined

    return row?.name
}

/**
 * Downloads the original media bytes referenced by a synced WhatsApp message.
 * @example
 * const buffer = await downloadMessageMedia({ message, s3 })
 */
async function downloadMessageMedia(args: { message: WhatsappSyncMessage; s3: S3Client }) {
    const { message, s3 } = args
    if (!isImageMessage(message)) return undefined
    if (!message.mediaPath?.startsWith(`r2://`)) return undefined

    const location = parseR2ObjectUri(message.mediaPath)
    if (!location) return undefined

    try {
        const response = await s3.getObject(location.objectKey, { bucketName: location.bucketName })
        const arrayBuffer = await response.arrayBuffer()
        if (!arrayBuffer.byteLength) return undefined

        return Buffer.from(arrayBuffer)
    } catch (error) {
        if (!isMissingObjectError(error)) throw error

        console.warn(
            `[whatsapp] Missing R2 media for message ${message.messageId}: ${location.bucketName}/${location.objectKey}`
        )
        return undefined
    }
}

/**
 * Returns true when an S3/R2 request failed because the object key does not exist.
 * @example
 * isMissingObjectError(new Error(`The specified key does not exist.`))
 */
function isMissingObjectError(error: unknown) {
    if (!(error instanceof Error)) return false

    const s3Error = error as Error & { code?: string; statusCode?: number }
    if (s3Error.code === `NoSuchKey`) return true
    if (s3Error.statusCode === 404) return true
    if (error.message.includes(`The specified key does not exist.`)) return true

    return false
}

/**
 * Returns a resized image buffer for final upload and AI processing.
 * @example
 * const resized = await getResizedImageBufferFromMessage({ message, s3 })
 */
async function getResizedImageBufferFromMessage(args: { message: WhatsappSyncMessage; s3: S3Client }) {
    const imageBuffer = await downloadMessageMedia(args)
    if (!imageBuffer) return undefined

    const resize = await resizeCoverImage(imageBuffer)
    return resize.buffer
}

/**
 * Creates an inline AI image payload without persisting the image first.
 * @example
 * const imageInput = await getAiImageInputFromMessage({ message, s3 })
 */
async function getAiImageInputFromMessage(args: { message: WhatsappSyncMessage; s3: S3Client }) {
    const resized = await getResizedImageBufferFromMessage(args)
    if (!resized) return undefined

    return {
        image: resized,
        mediaType: `image/webp`
    } satisfies AiImageInput
}

/**
 * Uploads a WhatsApp image into the event asset bucket with cache reuse.
 * @example
 * const imageUrl = await extractPhotoFromMessage({ message, slug, s3 })
 */
async function extractPhotoFromMessage(args: { message: WhatsappSyncMessage; slug: string; s3: S3Client }) {
    const { message, slug, s3 } = args
    if (!isImageMessage(message)) return undefined

    try {
        const imageBuffer = await downloadMessageMedia({ message, s3 })
        if (!imageBuffer) return undefined

        const { buffer: resizedBuffer, phash: hash } = await resizeCoverImage(imageBuffer)
        const alreadyCachedImage = await db.query.imageCacheMap.findFirst({
            where: and(
                eq(s.imageCacheMap.originalUrl, `wa:${hash}:${slug}`),
                eq(s.imageCacheMap.eventSlug, slug)
            )
        })
        if (alreadyCachedImage) return alreadyCachedImage.url

        const imgUrl = await assets.uploadImage(resizedBuffer, slug, hash, assets.loadCreds())
        await db.insert(s.imageCacheMap).values({
            originalUrl: `wa:${hash}:${slug}`,
            eventSlug: slug,
            url: imgUrl
        })
        return imgUrl
    } catch (error) {
        console.error(`Error extracting photo from message`, message.messageId, error)
        return undefined
    }
}

/**
 * Finds nearby image messages from the same sender within the event window.
 * @example
 * const result = findAdjacentImageMessages({ currentMessage, allMessages })
 */
function findAdjacentImageMessages(args: { currentMessage: WhatsappSyncMessage; allMessages: WhatsappSyncMessage[] }) {
    const { currentMessage, allMessages } = args
    const adjacentMessages: WhatsappSyncMessage[] = []
    const messageIds: string[] = []
    const currentAuthorId = currentMessage.senderJid
    if (!currentAuthorId) return { messages: adjacentMessages, messageIds }

    const sortedMessages = [...allMessages].sort((a, b) => compareMessages(a, b))
    const currentMessageIndex = sortedMessages.findIndex((message) => message.messageId === currentMessage.messageId)
    if (currentMessageIndex === -1) return { messages: adjacentMessages, messageIds }

    for (const message of allMessages) {
        if (message.senderJid !== currentAuthorId) continue
        if (!isImageMessage(message)) continue

        const timeDiff = Math.abs(message.timestamp - currentMessage.timestamp)
        if (timeDiff > maxSecondsBetweenMessagesForSameEvent) continue

        const messageIndex = sortedMessages.findIndex((candidate) => candidate.messageId === message.messageId)
        if (messageIndex === -1) continue

        const hasText = hasTextMessagesBetween({
            sortedMessages,
            eventIndex: currentMessageIndex,
            imageIndex: messageIndex,
            senderJid: currentAuthorId
        })
        if (hasText) continue

        adjacentMessages.push(message)
        messageIds.push(message.messageId)
    }

    return { messages: adjacentMessages, messageIds }
}

/**
 * Collects adjacent image inputs for AI processing.
 * @example
 * const result = await collectAdjacentImageInputs({ currentMessage, allMessages, s3 })
 */
async function collectAdjacentImageInputs(args: {
    currentMessage: WhatsappSyncMessage
    allMessages: WhatsappSyncMessage[]
    s3: S3Client
}) {
    const { messages, messageIds } = findAdjacentImageMessages({
        currentMessage: args.currentMessage,
        allMessages: args.allMessages
    })
    const imageInputs: AiImageInput[] = []

    for (const message of messages) {
        const imageInput = await getAiImageInputFromMessage({ message, s3: args.s3 })
        if (imageInput) imageInputs.push(imageInput)
    }

    return { imageInputs, messageIds }
}

/**
 * Uploads adjacent image messages and returns their final asset URLs.
 * @example
 * const result = await extractAdjacentImagesWithIds({ currentMessage, allMessages, s3, slug })
 */
async function extractAdjacentImagesWithIds(args: {
    currentMessage: WhatsappSyncMessage
    allMessages: WhatsappSyncMessage[]
    s3: S3Client
    slug: string
}) {
    const imageUrls: string[] = []
    const { messages, messageIds } = findAdjacentImageMessages({
        currentMessage: args.currentMessage,
        allMessages: args.allMessages
    })

    for (const message of messages) {
        const imageUrl = await extractPhotoFromMessage({ message, slug: args.slug, s3: args.s3 })
        if (imageUrl) imageUrls.push(imageUrl)
    }

    return { imageUrls, messageIds }
}

/**
 * Collects nearby text messages that likely belong to the same event announcement.
 * @example
 * const result = await extractAdjacentTextMessages({ currentMessage, allMessages })
 */
async function extractAdjacentTextMessages(args: {
    currentMessage: WhatsappSyncMessage
    allMessages: WhatsappSyncMessage[]
}) {
    const textMessages: string[] = []
    const messageIds: string[] = []
    const currentAuthorId = args.currentMessage.senderJid
    if (!currentAuthorId) return { textMessages, messageIds }

    for (const message of args.allMessages) {
        if (message.senderJid !== currentAuthorId) continue
        if (message.messageId === args.currentMessage.messageId) continue

        const timeDiff = Math.abs(message.timestamp - args.currentMessage.timestamp)
        if (timeDiff > maxSecondsBetweenMessagesForSameEvent) continue

        const messageText = message.textValue?.trim()
        if (!messageText?.length) continue

        textMessages.push(messageText)
        messageIds.push(message.messageId)
    }

    return { textMessages, messageIds }
}

/**
 * Returns true when text from the same sender sits between two grouped messages.
 * @example
 * hasTextMessagesBetween({ sortedMessages, eventIndex: 0, imageIndex: 2, senderJid: `123@s.whatsapp.net` })
 */
function hasTextMessagesBetween(args: {
    sortedMessages: WhatsappSyncMessage[]
    eventIndex: number
    imageIndex: number
    senderJid: string
}) {
    const startIndex = Math.min(args.eventIndex, args.imageIndex)
    const endIndex = Math.max(args.eventIndex, args.imageIndex)

    for (let i = startIndex + 1; i < endIndex; i++) {
        const message = args.sortedMessages[i]
        if (message.senderJid !== args.senderJid) continue
        if ((message.textValue?.trim().length ?? 0) <= 30) continue
        return true
    }

    return false
}

/**
 * Extracts an event from a flyer-style image message.
 * @example
 * const result = await extractEventDataFromImageMessage({ message, allMessages, defaultTimezone, target, s3 })
 */
async function extractEventDataFromImageMessage(args: {
    message: WhatsappSyncMessage
    allMessages: WhatsappSyncMessage[]
    defaultTimezone: string
    target: WhatsappScrapingTarget
    s3: S3Client
}) {
    if (!isImageMessage(args.message)) return undefined

    console.log(`[whatsapp] Processing image message for event extraction: ${args.message.messageId}`)
    const imageInput = await getAiImageInputFromMessage({ message: args.message, s3: args.s3 })
    if (!imageInput) {
        console.log(`[whatsapp] Could not build AI image input for message ${args.message.messageId}`)
        return undefined
    }

    const { textMessages: adjacentTextMessages, messageIds: adjacentTextMessageIds } = await extractAdjacentTextMessages({
        currentMessage: args.message,
        allMessages: args.allMessages
    })
    const combinedText = adjacentTextMessages.length > 0 ? adjacentTextMessages.join(`\n\n`) : ``

    await sleep(1000)
    const aiAnswer = await aiExtractEventData({
        message: combinedText,
        messageDate: new Date(args.message.timestamp * 1000),
        timezone: args.defaultTimezone,
        authorName: getWhatsappAuthor(args.message).name,
        imageInputs: [imageInput],
        model: `openai`,
    })

    const base = await validateAndBuildEventBase({
        aiAnswer,
        message: args.message,
        target: args.target,
        descriptionOriginal: combinedText || aiAnswer.description || ``
    })
    if (!base) return undefined

    const { baseEvent, slug } = base
    const mainImageUrl = await extractPhotoFromMessage({ message: args.message, slug, s3: args.s3 })
    const { imageUrls: additionalImageUrls, messageIds: adjacentImageMessageIds } = await extractAdjacentImagesWithIds({
        currentMessage: args.message,
        allMessages: args.allMessages,
        s3: args.s3,
        slug
    })
    const allImageUrls = Array.from(new Set([...(mainImageUrl ? [mainImageUrl] : []), ...additionalImageUrls]))

    baseEvent.imageUrls = allImageUrls
    const mergedEvent = await mergeWithExistingEventBySlug(baseEvent)

    return {
        event: mergedEvent,
        adjacentMessageIds: [...adjacentTextMessageIds, ...adjacentImageMessageIds]
    }
}

/**
 * Extracts an event from a text-first WhatsApp message, plus nearby images.
 * @example
 * const result = await extractEventDataFromMessage({ message, allMessages, defaultTimezone, target, s3 })
 */
async function extractEventDataFromMessage(args: {
    message: WhatsappSyncMessage
    allMessages: WhatsappSyncMessage[]
    defaultTimezone: string
    target: WhatsappScrapingTarget
    s3: S3Client
}) {
    const msgText = args.message.textValue?.trim()
    if (!msgText?.length) return undefined

    console.log(`[whatsapp] Extracting event from text message ${args.message.messageId}`)
    const { textMessages: adjacentTextMessages, messageIds: adjacentTextMessageIds } = await extractAdjacentTextMessages({
        currentMessage: args.message,
        allMessages: args.allMessages
    })
    const { imageInputs: adjacentImageInputs } = await collectAdjacentImageInputs({
        currentMessage: args.message,
        allMessages: args.allMessages,
        s3: args.s3
    })
    const combinedText = [msgText, ...adjacentTextMessages].join(`\n\n`)

    await sleep(1000)
    const aiAnswer = await aiExtractEventData({
        message: combinedText,
        messageDate: new Date(args.message.timestamp * 1000),
        timezone: args.defaultTimezone,
        authorName: getWhatsappAuthor(args.message).name,
        imageInputs: adjacentImageInputs,
        model: `openai`,
    })

    const base = await validateAndBuildEventBase({
        aiAnswer,
        message: args.message,
        target: args.target,
        descriptionOriginal: combinedText
    })
    if (!base) return undefined

    const { baseEvent, slug } = base
    const { imageUrls, messageIds: adjacentImageMessageIds } = await extractAdjacentImagesWithIds({
        currentMessage: args.message,
        allMessages: args.allMessages,
        s3: args.s3,
        slug
    })
    baseEvent.imageUrls = imageUrls
    const mergedEvent = await mergeWithExistingEventBySlug(baseEvent)

    return {
        event: mergedEvent,
        adjacentMessageIds: [...adjacentTextMessageIds, ...adjacentImageMessageIds]
    }
}

/**
 * Merges duplicate event rows created from the same WhatsApp batch.
 * @example
 * const uniqueEvents = mergeDuplicateEvents([eventA, eventB])
 */
function mergeDuplicateEvents(events: InsertEvent[]) {
    const uniqueEvents = new Map<string, InsertEvent>()

    for (const event of events) {
        const existing = uniqueEvents.get(event.slug)
        if (!existing) {
            uniqueEvents.set(event.slug, event)
            continue
        }

        const description = (event.description?.length ?? 0) > (existing.description?.length ?? 0)
            ? event.description
            : existing.description
        const imageUrls = mergeUniqueStrings(existing.imageUrls, event.imageUrls)
        const tags = mergeUniqueStrings(existing.tags, event.tags)
        const contact = mergeUniqueStrings(existing.contact, event.contact)
        const coords = mergeCoords({
            preferredLatitude: existing.latitude,
            preferredLongitude: existing.longitude,
            fallbackLatitude: event.latitude,
            fallbackLongitude: event.longitude
        })

        uniqueEvents.set(event.slug, {
            ...existing,
            description,
            imageUrls,
            tags,
            contact,
            latitude: coords.latitude,
            longitude: coords.longitude,
            listed: mergeListedValue({
                preferred: existing,
                fallback: event,
                mergedCoords: coords
            })
        })
    }

    return Array.from(uniqueEvents.values())
}

/**
 * Reuses richer data from an already-upserted event with the same slug.
 * @example
 * const merged = await mergeWithExistingEventBySlug(eventRow)
 */
async function mergeWithExistingEventBySlug(eventRow: InsertEvent) {
    const existingEvent = await db.query.events.findFirst({ where: eq(s.events.slug, eventRow.slug) })
    if (!existingEvent) return eventRow

    const merged: InsertEvent = { ...eventRow }
    if ((existingEvent.description?.length ?? 0) > (merged.description?.length ?? 0)) {
        console.log(`[whatsapp] Keeping longer existing description for slug ${eventRow.slug}`)
        merged.description = existingEvent.description ?? undefined
    }
    merged.slug = existingEvent.slug // never change slug
    merged.imageUrls = mergeUniqueStrings(existingEvent.imageUrls, merged.imageUrls)
    merged.tags = mergeUniqueStrings(existingEvent.tags, merged.tags)
    merged.contact = mergeUniqueStrings(existingEvent.contact, merged.contact)
    const coords = mergeCoords({
        preferredLatitude: merged.latitude,
        preferredLongitude: merged.longitude,
        fallbackLatitude: existingEvent.latitude,
        fallbackLongitude: existingEvent.longitude
    })
    merged.latitude = coords.latitude
    merged.longitude = coords.longitude
    merged.listed = mergeListedValue({
        preferred: merged,
        fallback: existingEvent,
        mergedCoords: coords
    })
    return merged
}

/**
 * Deduplicates nullable string arrays while preserving first-seen order.
 * @example
 * mergeUniqueStrings([`a`], [`a`, `b`])
 */
function mergeUniqueStrings(...values: Array<string[] | null | undefined>) {
    return Array.from(new Set(values.flatMap((value) => value ?? [])))
}

/**
 * Keeps the preferred complete coordinate pair, otherwise falls back to the backup pair.
 * @example
 * mergeCoords({ preferredLatitude: null, preferredLongitude: null, fallbackLatitude: 1, fallbackLongitude: 2 })
 */
function mergeCoords(args: {
    preferredLatitude: number | null | undefined
    preferredLongitude: number | null | undefined
    fallbackLatitude: number | null | undefined
    fallbackLongitude: number | null | undefined
}): { latitude: number | null; longitude: number | null } {
    const preferredHasCoords = args.preferredLatitude != null && args.preferredLongitude != null
    if (preferredHasCoords) {
        return {
            latitude: args.preferredLatitude ?? null,
            longitude: args.preferredLongitude ?? null
        }
    }

    return {
        latitude: args.fallbackLatitude ?? args.preferredLatitude ?? null,
        longitude: args.fallbackLongitude ?? args.preferredLongitude ?? null
    }
}

/**
 * Allows a richer duplicate with resolved coordinates to relist an unresolved event.
 * @example
 * mergeListedValue({ preferred: { listed: false }, fallback: { listed: true }, mergedCoords: { latitude: 1, longitude: 2 } })
 */
function mergeListedValue(args: {
    preferred: { listed?: boolean | null; latitude?: number | null; longitude?: number | null }
    fallback: { listed?: boolean | null; latitude?: number | null; longitude?: number | null }
    mergedCoords: { latitude: number | null; longitude: number | null }
}) {
    if (args.preferred.listed === true) return true

    const preferredHasCoords = args.preferred.latitude != null && args.preferred.longitude != null
    const fallbackHasCoords = args.fallback.latitude != null && args.fallback.longitude != null
    const mergedHasCoords = args.mergedCoords.latitude != null && args.mergedCoords.longitude != null
    if (!preferredHasCoords && fallbackHasCoords && args.fallback.listed === true && mergedHasCoords) {
        return true
    }

    return false
}

/**
 * Resolves the final event address, including target defaults.
 * @example
 * const address = await normalizeAddress({ aiAnswer, target })
 */
async function normalizeAddress(args: { aiAnswer: MsgAnalysisAnswer; target: WhatsappScrapingTarget }) {
    const { aiAnswer, target } = args
    if (aiAnswer.attendanceMode === `online`) return undefined

    if (!aiAnswer.address && !aiAnswer.venue && !aiAnswer.city) {
        if (!target.defaultAddress?.length) return undefined
        aiAnswer.address = target.defaultAddress.join(`,`)
    }

    let addressArr = aiAnswer.address ? aiAnswer.address.split(`,`) : []
    if (aiAnswer.venue && !aiAnswer.address?.includes(aiAnswer.venue)) addressArr = [aiAnswer.venue, ...addressArr]
    if (aiAnswer.city && !aiAnswer.address?.includes(aiAnswer.city)) addressArr = [...addressArr, aiAnswer.city]
    return addressArr
}

/**
 * True when the event should not be scraped: already ended, or no end time and start is in the past.
 * Multi-day events still running (end in the future) are not treated as past.
 * @example
 * shouldSkipScrapedEventAsPast({ startAt, endAt: null }) // yesterday’s one-off → true
 */
function shouldSkipScrapedEventAsPast(args: { startAt: Date; endAt: Date | null }) {
    const now = Date.now()
    const startMs = args.startAt.getTime()
    if (Number.isNaN(startMs)) return true
    const endMs = args.endAt && !Number.isNaN(args.endAt.getTime()) ? args.endAt.getTime() : null
    if (endMs !== null) return endMs < now
    return startMs < now
}

/**
 * Validates the AI answer and converts it into the event insert shape.
 * @example
 * const base = await validateAndBuildEventBase({ aiAnswer, message, target, descriptionOriginal })
 */
async function validateAndBuildEventBase(args: {
    aiAnswer: MsgAnalysisAnswer
    message: WhatsappSyncMessage
    target: WhatsappScrapingTarget
    descriptionOriginal: string
}) {
    const { aiAnswer, message, target, descriptionOriginal } = args

    if (aiAnswer.existingSource) {
        console.log(`[whatsapp] Skipping event — existing source: ${aiAnswer.existingSource}`)
        return undefined
    }
    if (!aiAnswer.hasEventData) {
        console.log(`[whatsapp] Skipping event — no event data detected`)
        return undefined
    }
    if (!aiAnswer.name) {
        console.log(`[whatsapp] Skipping event — no name`)
        return undefined
    }
    if (!aiAnswer.startDate) {
        console.log(`[whatsapp] Skipping event — no start date`)
        return undefined
    }

    const startAt = new Date(aiAnswer.startDate)
    if (Number.isNaN(startAt.getTime())) {
        console.log(`[whatsapp] Skipping event — invalid start date: ${aiAnswer.startDate}`)
        return undefined
    }

    const endAtRaw = aiAnswer.endDate ? new Date(aiAnswer.endDate) : null
    const endAt = endAtRaw && !Number.isNaN(endAtRaw.getTime()) ? endAtRaw : null

    if (shouldSkipScrapedEventAsPast({ startAt, endAt })) {
        if (endAt) {
            console.log(`[whatsapp] Skipping event — already ended: ${endAt.toISOString()}`)
        } else {
            console.log(`[whatsapp] Skipping event — start in past: ${startAt.toISOString()}`)
        }
        return undefined
    }

    const addressArr = await normalizeAddress({ aiAnswer, target })
    if (aiAnswer.attendanceMode === `offline` && !addressArr?.length) {
        console.log(`[whatsapp] Skipping event — offline but no address`)
        return undefined
    }

    const coords = await geocodeAddressCached({
        addressLines: addressArr,
        apiKey: googleMapsApiKey || ``,
        biasAddressLines: target.defaultAddress
    })
    const contact = normalizeWhatsappContacts(aiAnswer.contact)
    const author = getWhatsappAuthor(message)

    if (aiAnswer.contactAuthorForMore) {
        if (author.link && !contact.includes(author.link)) contact.push(author.link)
        if (!contact.some((value) => value.startsWith(`https://wa.me/`) || value.startsWith(`https://api.whatsapp.com`))) {
            console.log(`[whatsapp] Skipping event — contact author requested but no WhatsApp link`)
            return undefined
        }
    }

    const name = aiAnswer.name.trim()
    const slug = generateSlug({ name, startAt, endAt: endAt || undefined })
    let latitude = coords?.lat
    let longitude = coords?.lng
    let listed = aiAnswer.isConscious ?? true

    if (addressArr?.length && (latitude == null || longitude == null)) {
        if (!contact?.length) {
            listed = false
            console.log(`[whatsapp] Unresolved address without contact — marking event as unlisted`)
        } else if (target.defaultAddress?.length) {
            const defaultCoords = await geocodeAddressCached({
                addressLines: target.defaultAddress,
                apiKey: googleMapsApiKey || ``
            })
            if (defaultCoords?.lat != null && defaultCoords?.lng != null) {
                latitude = defaultCoords.lat
                longitude = defaultCoords.lng
                console.log(`[whatsapp] Using target defaultAddress coordinates for unresolved event address`)
            } else {
                console.log(`[whatsapp] Could not resolve target defaultAddress coordinates for unresolved event address`)
            }
        }
    }

    const baseEvent: InsertEvent = {
        name,
        imageUrls: [],
        startAt,
        endAt,
        attendanceMode: aiAnswer.attendanceMode,
        address: addressArr,
        tags: aiAnswer.tags,
        latitude,
        longitude,
        price: aiAnswer.price,
        description: aiAnswer.description,
        descriptionOriginal,
        host: author.name,
        hostLink: author.link,
        sourceUrl: aiAnswer.url,
        messageSenderId: author.id,
        contact,
        listed,
        source: `whatsapp`,
        slug
    }

    return { baseEvent, slug }
}

/**
 * Processes a chronological slice of synced WhatsApp messages for one chat.
 * @example
 * const result = await processMessages({ messages, target, s3 })
 */
async function processMessages(args: {
    messages: WhatsappSyncMessage[]
    target: WhatsappScrapingTarget
    s3: S3Client
}) {
    let events: InsertEvent[] = []
    const processedMessageIds = new Set<string>()
    const sortedMessages = [...args.messages].sort((a, b) => compareMessages(a, b))
    const defaultTimezone = args.target.defaultTimezone

    console.log(
        `[whatsapp] Processing ${sortedMessages.length} message(s) for chat ${args.target.chatJid} (timezone ${defaultTimezone})`
    )

    for (const message of sortedMessages) {
        if (processedMessageIds.has(message.messageId)) {
            console.log(`[whatsapp] Skip already-processed message ${message.messageId}`)
            continue
        }

        const messageText = message.textValue?.trim()
        const messageTimestampIso = new Date(message.timestamp * 1000).toISOString()
        const messagePreview = messageText?.replace(/\s+/g, ` `).slice(0, 50) ?? ``
        const kind = (messageText?.length ?? 0) > 30
            ? `text`
            : isImageMessage(message)
                ? `image`
                : `skip`
        console.log(
            `[whatsapp] msg ${message.messageId}: ${kind}${messageText?.length ? ` (${messageText.length} chars)` : ``} @ ${messageTimestampIso} "${messagePreview}"`
        )

        if ((messageText?.length ?? 0) > 30) {
            const result = await extractEventDataFromMessage({
                message,
                allMessages: args.messages,
                defaultTimezone,
                target: args.target,
                s3: args.s3
            })
            if (!result) {
                console.log(`[whatsapp] No event extracted from text message ${message.messageId}`)
                continue
            }

            console.log(`[whatsapp] Event candidate from text: slug ${result.event.slug}`)
            events.push(result.event)
            processedMessageIds.add(message.messageId)
            result.adjacentMessageIds.forEach((id) => processedMessageIds.add(id))
            continue
        }

        if (!isImageMessage(message)) continue
        const result = await extractEventDataFromImageMessage({
            message,
            allMessages: args.messages,
            defaultTimezone,
            target: args.target,
            s3: args.s3
        })
        if (!result) {
            console.log(`[whatsapp] No event extracted from image message ${message.messageId}`)
            continue
        }

        console.log(`[whatsapp] Event candidate from image: slug ${result.event.slug}`)
        events.push(result.event)
        processedMessageIds.add(message.messageId)
        result.adjacentMessageIds.forEach((id) => processedMessageIds.add(id))
    }

    events = mergeDuplicateEvents(events)
    const beforePastFilter = events.length
    events = events.filter((eventRow) => {
        const end = eventRow.endAt ?? null
        if (!shouldSkipScrapedEventAsPast({ startAt: eventRow.startAt, endAt: end })) return true
        console.log(`[whatsapp] Dropping past event before persist: ${eventRow.slug}`)
        return false
    })
    if (beforePastFilter > events.length) {
        console.log(`[whatsapp] Removed ${beforePastFilter - events.length} past event(s) after merge`)
    }
    if (events.length > 0) {
        console.log(`[whatsapp] Inserting ${events.length} event(s): ${events.map((e) => e.slug).join(`, `)}`)
        await insertEvents(events)
        console.log("events", events)
    } else {
        console.log(`[whatsapp] No events to insert for this batch`)
    }

    return { scrapedEventsCount: events.length }
}

/**
 * Processes one configured WhatsApp scraping target and persists state.
 * @example
 * const result = await processScrapingTarget({ target, sqliteDb, s3 })
 */
async function processScrapingTarget(args: {
    target: WhatsappScrapingTarget
    sqliteDb: Database
    s3: S3Client
}) {
    const { target, sqliteDb, s3 } = args

    try {
        const chatName = getChatName({ sqliteDb, chatJid: target.chatJid })
        const label = chatName ?? target.name ?? target.chatJid
        console.log(`\n[whatsapp] Target: ${label} (${target.chatJid})`)

        const messages = getMessagesForTarget({ sqliteDb, target })
        const loadHint = target.lastMessageTimestamp
            ? `since last cursor (no cap)`
            : `latest ${initialMessagesPerChat} (first run for chat)`
        console.log(`[whatsapp] Loaded ${messages.length} message(s) — ${loadHint}`)

        if (!messages.length) {
            console.log(`[whatsapp] No new messages — updating last run only`)
            await db.update(s.whatsappScrapingTargets)
                .set({
                    name: chatName ?? target.name,
                    lastRunFinishedAt: new Date(),
                    lastError: null
                })
                .where(eq(s.whatsappScrapingTargets.chatJid, target.chatJid))

            return { success: true, target }
        }

        const { scrapedEventsCount } = await processMessages({ messages, target, s3 })
        const latestMessage = messages[messages.length - 1]
        console.log(
            `[whatsapp] Done ${label}: +${scrapedEventsCount} event(s), cursor ${latestMessage.messageId} @ ${new Date(latestMessage.timestamp * 1000).toISOString()}`
        )

        await db.update(s.whatsappScrapingTargets)
            .set({
                name: chatName ?? target.name,
                lastMessageId: latestMessage.messageId,
                lastMessageTimestamp: new Date(latestMessage.timestamp * 1000),
                lastError: null,
                scrapedEvents: target.scrapedEvents + scrapedEventsCount,
                messagesConsumed: target.messagesConsumed + messages.length,
                lastRunFinishedAt: new Date()
            })
            .where(eq(s.whatsappScrapingTargets.chatJid, target.chatJid))

        return { success: true, target }
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        console.error(`[whatsapp] Error processing target ${target.chatJid}:`, err)

        await db.update(s.whatsappScrapingTargets)
            .set({
                lastError: err.message,
                lastRunFinishedAt: new Date()
            })
            .where(eq(s.whatsappScrapingTargets.chatJid, target.chatJid))

        return { success: false, error: err, target }
    }
}

/**
 * Runs scraping targets through a small worker pool.
 * @example
 * const fatalErrors = await processTargetsWithWorkerPool({ targets, sqliteDb, s3 })
 */
async function processTargetsWithWorkerPool(args: {
    targets: WhatsappScrapingTarget[]
    sqliteDb: Database
    s3: S3Client
}) {
    const fatalErrors: Error[] = []
    const maxConcurrent = 3
    const targetQueue = [...args.targets]
    const activeWorkers = new Set<Promise<void>>()
    let workerIdSeq = 0
    let completedTargets = 0
    const totalTargets = args.targets.length

    const spawnWorker = () => {
        const workerId = ++workerIdSeq
        console.log(`[whatsapp] Worker #${workerId} starting`)
        const worker = createWorker({
            workerId,
            targetQueue,
            sqliteDb: args.sqliteDb,
            s3: args.s3,
            fatalErrors,
            onTargetDone: () => {
                completedTargets += 1
                console.log(`[whatsapp] Progress: ${completedTargets}/${totalTargets} targets finished`)
            }
        })

        worker.finally(() => {
            activeWorkers.delete(worker)
            console.log(`[whatsapp] Worker #${workerId} idle (queue: ${targetQueue.length}, active workers: ${activeWorkers.size})`)
            if (targetQueue.length > 0 && activeWorkers.size < maxConcurrent) {
                const replacement = spawnWorker()
                activeWorkers.add(replacement)
            }
        })

        return worker
    }

    console.log(
        `[whatsapp] Starting pool: up to ${maxConcurrent} concurrent worker(s) for ${totalTargets} target(s)`
    )

    for (let i = 0; i < Math.min(maxConcurrent, args.targets.length); i++) {
        const worker = spawnWorker()
        activeWorkers.add(worker)
    }

    while (targetQueue.length > 0 || activeWorkers.size > 0) {
        if (activeWorkers.size > 0) await Promise.race(Array.from(activeWorkers))
        await sleep(100)
    }

    console.log(`[whatsapp] All targets processed`)
    return fatalErrors
}

/**
 * Pulls chats from the shared queue until no WhatsApp targets remain.
 * @example
 * await createWorker({ targetQueue, sqliteDb, s3, fatalErrors })
 */
async function createWorker(args: {
    workerId: number
    targetQueue: WhatsappScrapingTarget[]
    sqliteDb: Database
    s3: S3Client
    fatalErrors: Error[]
    onTargetDone: () => void
}) {
    while (args.targetQueue.length > 0) {
        const target = args.targetQueue.shift()
        if (!target) break

        const remaining = args.targetQueue.length
        console.log(
            `[whatsapp] Worker #${args.workerId} → ${target.chatJid} (${remaining} left in queue)`
        )

        const result = await processScrapingTarget({
            target,
            sqliteDb: args.sqliteDb,
            s3: args.s3
        })
        args.onTargetDone()
        if (!result.success && result.error) args.fatalErrors.push(result.error)
    }
    console.log(`[whatsapp] Worker #${args.workerId} exiting — queue empty`)
}

/**
 * Parses `r2://bucket/key` URIs from the WhatsApp sync database.
 * @example
 * parseR2ObjectUri(`r2://bucket-name/media/chat/file.jpg`)
 */
function parseR2ObjectUri(uri: string) {
    if (!uri.startsWith(`r2://`)) return undefined

    const withoutScheme = uri.slice(`r2://`.length)
    const slashIndex = withoutScheme.indexOf(`/`)
    if (slashIndex === -1) return undefined

    const bucketName = withoutScheme.slice(0, slashIndex)
    const objectKey = withoutScheme.slice(slashIndex + 1)
    if (!bucketName || !objectKey) return undefined

    return { bucketName, objectKey }
}

/**
 * Provides deterministic ordering for WhatsApp rows.
 * @example
 * compareMessages(messageA, messageB)
 */
function compareMessages(a: WhatsappSyncMessage, b: WhatsappSyncMessage) {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp
    const serverIdComparison = compareOptionalNumbers(a.serverId, b.serverId)
    if (serverIdComparison !== 0) return serverIdComparison
    return compareTextIds(a.messageId, b.messageId)
}

/**
 * Builds the SQL order clause that matches `compareMessages`.
 * @example
 * getWhatsappMessageOrderBySql({ descending: false })
 */
function getWhatsappMessageOrderBySql(args: { descending: boolean }) {
    const direction = args.descending ? `DESC` : `ASC`
    const nullBucketDirection = args.descending ? `DESC` : `ASC`

    return [
        `timestamp ${direction}`,
        `CASE WHEN server_id IS NULL THEN 1 ELSE 0 END ${nullBucketDirection}`,
        `server_id ${direction}`,
        `message_id ${direction}`
    ].join(`, `)
}

/**
 * Drops rows at or before the persisted cursor after replaying the cursor second.
 * @example
 * trimMessagesAfterCursor({ messages, lastTimestamp: 1, lastMessageId: `abc` })
 */
function trimMessagesAfterCursor(args: {
    messages: WhatsappSyncMessage[]
    lastTimestamp: number | undefined
    lastMessageId: string | null | undefined
}) {
    if (args.lastTimestamp === undefined) return args.messages
    if (!args.lastMessageId) {
        console.warn(`[whatsapp] Cursor timestamp exists without lastMessageId; replaying the whole cursor second`)
        return args.messages
    }

    const cursorIndex = args.messages.findIndex((message) => message.messageId === args.lastMessageId)
    if (cursorIndex === -1) {
        console.warn(`[whatsapp] Cursor message ${args.lastMessageId} not found in replay window; replaying messages from ${args.lastTimestamp}`)
        return args.messages
    }

    return args.messages.slice(cursorIndex + 1)
}

/**
 * Sorts optional numeric IDs with nulls after concrete values.
 * @example
 * compareOptionalNumbers(10, null)
 */
function compareOptionalNumbers(a: number | null, b: number | null) {
    if (a === b) return 0
    if (a === null) return 1
    if (b === null) return -1
    return a - b
}

/**
 * Matches SQLite-style text ordering without locale-sensitive collation.
 * @example
 * compareTextIds(`a`, `b`)
 */
function compareTextIds(a: string, b: string) {
    if (a === b) return 0
    return a < b ? -1 : 1
}

/**
 * Runs the WhatsApp scraper entrypoint.
 * @example
 * await main()
 */
async function main() {
    console.log(
        `[whatsapp] Scraper starting (first run per chat: latest ${initialMessagesPerChat} messages; later runs: all since cursor)`
    )
    const creds = loadWhatsapp2SqliteCreds()
    const s3 = new S3Client(creds)
    const sqlitePath = await downloadWhatsappSqliteSnapshot()
    const sqliteDb = openWhatsappSqlite(sqlitePath)
    console.log(`[whatsapp] SQLite opened read-only`)

    try {
        const scrapingTargets = await db.select().from(s.whatsappScrapingTargets)
        if (!scrapingTargets.length) {
            console.log(`[whatsapp] No WhatsApp scraping targets in database — nothing to do`)
            return
        }

        console.log(`[whatsapp] Loaded ${scrapingTargets.length} target(s), shuffling order`)
        scrapingTargets.sort(() => Math.random() - 0.5)
        const fatalErrors = await processTargetsWithWorkerPool({
            targets: scrapingTargets,
            sqliteDb,
            s3
        })
        if (fatalErrors.length > 0) {
            console.error(`[whatsapp] Fatal errors:`, fatalErrors.map((error) => error.message))
            process.exitCode = 1
        } else {
            console.log(`[whatsapp] Run finished successfully`)
        }
    } finally {
        sqliteDb.close()
        await rm(sqlitePath, { force: true })
        await closeScriptConnections()
        console.log(`[whatsapp] Temp DB removed, SQLite closed`)
    }
}

await main()

/**
 * Closes long-lived clients created by script-only imports.
 * @example
 * await closeScriptConnections()
 */
async function closeScriptConnections() {
    const postgresClient = (db as DrizzleDbWithClient).$client
    if (!postgresClient?.end) return
    await postgresClient.end({ timeout: 5 })
}

type WhatsappAuthor = {
    id: string
    name: string
    link: string | undefined
    phoneNumber: string | undefined
}

type DrizzleDbWithClient = {
    $client?: {
        end?: (args?: { timeout?: number }) => Promise<void>
    }
}

type WhatsappSyncMessage = {
    category: string | null
    chatJid: string
    isEdit: number
    isEphemeral: number
    isFromMe: number
    isGroup: number
    isViewOnce: number
    mediaMimeType: string | null
    mediaPath: string | null
    mediaSha256: string | null
    mediaType: string | null
    messageId: string
    messageType: string | null
    pushName: string | null
    rawMessageJson: string | null
    senderJid: string
    senderPhoneNumber: string | null
    serverId: number | null
    source: string
    sourceWebMessageJson: string | null
    textValue: string | null
    timestamp: number
    updatedAt: number
}
