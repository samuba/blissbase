import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import readline from "readline";
import 'dotenv/config'
import { db, eq, s } from '../src/lib/server/db';
import { InsertEvent } from "../src/lib/types";
import type { TelegramScrapingTarget } from "../src/lib/server/schema";
import { generateSlug, parseTelegramContact, sleep } from "../src/lib/common";
import { geocodeAddressCached } from "../src/lib/server/google";
import { TotalList } from "telegram/Helpers";
import { aiExtractEventData } from "../blissbase-telegram-entry/src/ai";
import type { MsgAnalysisAnswer } from "../blissbase-telegram-entry/src/ai";
import { calculatePhash, resizeCoverImage } from '../src/lib/imageProcessing';
import { insertEvents } from "../src/lib/server/events";
import type { Entity } from "telegram/define";
import * as cloudinary from "../src/lib/cloudinary";

const apiId = Number(process.env.TELEGRAM_APP_ID);
const apiHash = process.env.TELEGRAM_APP_HASH!;
const sessionAuthKeyString = process.env.TELEGRAM_APP_SESSION ?? "";
const sessionAuthKey = new StringSession(sessionAuthKeyString);
const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY!;

// Minimal shape we rely on from the AI output to keep helpers local to this file
type AiAnswerMinimal = Pick<MsgAnalysisAnswer,
    'hasEventData' | 'existingSource' | 'name' | 'description' | 'summary' |
    'startDate' | 'endDate' | 'url' | 'contact' | 'contactAuthorForMore' | 'price' |
    'venue' | 'address' | 'city' | 'tags'
>;

function resolveTelegramFormattingToHtml(text: string, entities: Api.TypeMessageEntity[] | undefined): string {
    // Type definitions for converted entities
    type ConvertedEntity = {
        offset: number;
        length: number;
        type: string;
        url?: string;
        user?: { id: number };
    };

    // Interface for MessageEntityMentionName to avoid using any
    interface MessageEntityMentionName {
        className: string;
        offset: number;
        length: number;
        userId: number;
    }


    // Early return for no entities
    if (!entities?.length) {
        return lineBreaksToBr(text);
    }

    // Convert entities to a format compatible with the original function
    const convertedEntities: ConvertedEntity[] = entities.map(entity => {
        const baseEntity = {
            offset: entity.offset,
            length: entity.length,
        };

        // Map Telegram API entity types to our format
        if (entity.className === 'MessageEntityBold') {
            return { ...baseEntity, type: 'bold' };
        } else if (entity.className === 'MessageEntityItalic') {
            return { ...baseEntity, type: 'italic' };
        } else if (entity.className === 'MessageEntityCode') {
            return { ...baseEntity, type: 'code' };
        } else if (entity.className === 'MessageEntityPre') {
            return { ...baseEntity, type: 'pre' };
        } else if (entity.className === 'MessageEntityUrl') {
            return { ...baseEntity, type: 'url' };
        } else if (entity.className === 'MessageEntityTextUrl') {
            return { ...baseEntity, type: 'text_link', url: (entity as Api.MessageEntityTextUrl).url };
        } else if (entity.className === 'MessageEntityMention') {
            return { ...baseEntity, type: 'mention' };
        } else if (entity.className === 'MessageEntityHashtag') {
            return { ...baseEntity, type: 'hashtag' };
        } else if (entity.className === 'MessageEntityStrike') {
            return { ...baseEntity, type: 'strikethrough' };
        } else if (entity.className === 'MessageEntityUnderline') {
            return { ...baseEntity, type: 'underline' };
        } else if (entity.className === 'MessageEntityMentionName') {
            return { ...baseEntity, type: 'text_mention', user: { id: (entity as unknown as MessageEntityMentionName).userId } };
        } else if (entity.className === 'MessageEntityCashtag') {
            return { ...baseEntity, type: 'cashtag' };
        } else if (entity.className === 'MessageEntityBotCommand') {
            return { ...baseEntity, type: 'bot_command' };
        } else if (entity.className === 'MessageEntityEmail') {
            return { ...baseEntity, type: 'email' };
        } else if (entity.className === 'MessageEntityPhone') {
            return { ...baseEntity, type: 'phone_number' };
        } else if (entity.className === 'MessageEntitySpoiler') {
            return { ...baseEntity, type: 'spoiler' };
        } else if (entity.className === 'MessageEntityBlockquote') {
            return { ...baseEntity, type: 'blockquote' };
        }

        // Default case - return with empty type
        return { ...baseEntity, type: '' };
    });

    // Pre-calculate opening and closing tags for all entities to avoid repeated function calls
    const entityTags = new WeakMap<ConvertedEntity, { opening: string, closing: string }>();

    for (const entity of convertedEntities) {
        const content = text.slice(entity.offset, entity.offset + entity.length);
        entityTags.set(entity, {
            opening: getOpeningTag(entity, content),
            closing: getClosingTag(entity.type)
        });
    }

    // Pre-group entities by their start and end positions for faster lookup
    const entitiesByStartPos = new Map<number, ConvertedEntity[]>();
    const entitiesByEndPos = new Map<number, ConvertedEntity[]>();
    const changePositions = new Set<number>();

    for (const entity of convertedEntities) {
        const startPos = entity.offset;
        const endPos = entity.offset + entity.length;

        // Group starting entities
        if (!entitiesByStartPos.has(startPos)) {
            entitiesByStartPos.set(startPos, []);
        }
        entitiesByStartPos.get(startPos)!.push(entity);

        // Group ending entities
        if (!entitiesByEndPos.has(endPos)) {
            entitiesByEndPos.set(endPos, []);
        }
        entitiesByEndPos.get(endPos)!.push(entity);

        changePositions.add(startPos);
        changePositions.add(endPos);
    }

    const sortedPositions = Array.from(changePositions).sort((a, b) => a - b);

    // Build result using array for better performance than string concatenation
    const resultParts: string[] = [];
    const activeEntities: ConvertedEntity[] = [];
    let lastPos = 0;

    // Process only positions where formatting actually changes
    for (const pos of sortedPositions) {
        // Add text segment before this position
        if (pos > lastPos) {
            resultParts.push(text.slice(lastPos, pos));
        }

        // Get entities that start or end at this position (pre-calculated)
        const startingEntities = entitiesByStartPos.get(pos) || [];
        const endingEntities = entitiesByEndPos.get(pos) || [];

        // Handle ending entities first (close tags in reverse order)
        if (endingEntities.length > 0) {
            // Close all active entities in reverse order (LIFO)
            for (let i = activeEntities.length - 1; i >= 0; i--) {
                resultParts.push(entityTags.get(activeEntities[i])!.closing);
            }

            // Remove ending entities from active list efficiently
            for (const endingEntity of endingEntities) {
                const index = activeEntities.indexOf(endingEntity);
                if (index !== -1) {
                    activeEntities.splice(index, 1);
                }
            }

            // Reopen remaining active entities in original order
            for (const entity of activeEntities) {
                resultParts.push(entityTags.get(entity)!.opening);
            }
        }

        // Handle starting entities (open new tags)
        for (const entity of startingEntities) {
            activeEntities.push(entity);
            resultParts.push(entityTags.get(entity)!.opening);
        }

        lastPos = pos;
    }

    // Add remaining text after the last formatting change
    if (lastPos < text.length) {
        resultParts.push(text.slice(lastPos));
    }

    // Join all parts and apply line break formatting
    return lineBreaksToBr(resultParts.join(''));

    function getOpeningTag(entity: ConvertedEntity, content: string): string {
        switch (entity.type) {
            case "bold": return '<b>';
            case "italic": return '<i>';
            case "underline": return '<u>';
            case "strikethrough": return '<s>';
            case "code": return '<code>';
            case "pre": return '<pre>';
            case "text_link": return `<a href="${entity.url?.startsWith("http") ? entity.url : "https://" + entity.url}" target="_blank">`;
            case "text_mention": return `<a href="tg://user?id=${entity.user?.id}" target="_blank">`;
            case "mention": return `<a href="tg://user?id=${content.slice(1)}" target="_blank">`;
            case "hashtag": return `<a href="tg://search?query=${encodeURIComponent(content)}" target="_blank">`;
            case "cashtag": return `<a href="tg://search?query=${encodeURIComponent(content)}" target="_blank">`;
            case "bot_command": return '<code>';
            case "url": return `<a href="${content}" target="_blank">`;
            case "email": return `<a href="mailto:${content}" target="_blank">`;
            case "phone_number": return `<a href="tel:${content}" target="_blank">`;
            case "spoiler": return '<span class="tg-spoiler">';
            case "blockquote": return '<blockquote>';
            default: return '';
        }
    }

    function getClosingTag(entityType: string): string {
        switch (entityType) {
            case "bold": return '</b>';
            case "italic": return '</i>';
            case "underline": return '</u>';
            case "strikethrough": return '</s>';
            case "code":
            case "bot_command": return '</code>';
            case "pre": return '</pre>';
            case "text_link":
            case "text_mention":
            case "mention":
            case "hashtag":
            case "cashtag":
            case "url":
            case "email":
            case "phone_number": return '</a>';
            case "spoiler": return '</span>';
            case "blockquote": return '</blockquote>';
            default: return '';
        }
    }

    function lineBreaksToBr(text: string): string {
        return text
            .replaceAll("\n", "<br>")
            .replace(/<br>(\s*<br>){2,}/g, '<br><br>');
    }
}

function getTelegramOriginalAuthorId(message: Api.Message) {
    if (message.fwdFrom?.fromId) {
        if (message.fwdFrom.fromId.className === 'PeerUser') {
            return message.fwdFrom.fromId.userId.toString();
        } else if (message.fwdFrom.fromId.className === 'PeerChat') {
            return message.fwdFrom.fromId.chatId.toString();
        } else if (message.fwdFrom.fromId.className === 'PeerChannel') {
            return message.fwdFrom.fromId.channelId.toString();
        }
    }
    // If not forwarded or no fwdFrom ID, use the direct sender
    else if (message.fromId) {
        if (message.fromId.className === 'PeerUser') {
            return message.fromId.userId.toString();
        } else if (message.fromId.className === 'PeerChat') {
            return message.fromId.chatId.toString();
        } else if (message.fromId.className === 'PeerChannel') {
            return message.fromId.channelId.toString();
        }
    } else if (message.peerId) {
        // Fallback for channel posts where fromId is typically undefined.
        if (message.peerId.className === 'PeerUser') {
            return message.peerId.userId.toString();
        } else if (message.peerId.className === 'PeerChat') {
            return message.peerId.chatId.toString();
        } else if (message.peerId.className === 'PeerChannel') {
            return message.peerId.channelId.toString();
        }
    }
}

async function getTelegramEventOriginalAuthor(message: Api.Message, client: TelegramClient) {
    if (!message) return undefined;

    let username: string | undefined;
    let firstName: string | undefined;
    let lastName: string | undefined;
    let channelTitle: string | undefined;

    function hasFirstNameField(x: unknown): x is { firstName?: string; lastName?: string; username?: string } {
        return typeof x === 'object' && x !== null && 'firstName' in (x as Record<string, unknown>);
    }

    function hasTitleField(x: unknown): x is { title?: string; username?: string } {
        return typeof x === 'object' && x !== null && 'title' in (x as Record<string, unknown>);
    }

    // Check if message is forwarded
    if (message.fwdFrom) {
        // Handle forwarded messages
        const fwdFrom = message.fwdFrom;
        if (fwdFrom.fromId) {
            try {
                // Fetch user details from the forwarded from ID
                const user = await client.getEntity(fwdFrom.fromId);
                if (user && 'firstName' in user) {
                    firstName = user.firstName;
                    lastName = user.lastName;
                    username = user.username;
                }
            } catch (error) {
                console.log('Could not fetch forwarded user details:', error);
            }
        }
        if (fwdFrom.fromName && !firstName) {
            // Use the forwarded from name if available and we couldn't get user details
            firstName = fwdFrom.fromName;
        }
    } else {
        // Regular message - get sender info from fromId
        if (message.fromId) {
            try {
                // Fetch user details from the from ID
                const user = await client.getEntity(message.fromId);
                if (hasFirstNameField(user)) {
                    firstName = user.firstName;
                    lastName = user.lastName;
                    username = user.username;
                } else if (hasTitleField(user)) {
                    // Channel/Chat entity
                    channelTitle = user.title;
                    username = user.username;
                }
            } catch (error) {
                console.log('Could not fetch user details:', error);
            }
        } else if (message.peerId) {
            // Channel posts: fromId is undefined, use peerId
            try {
                const entity = await client.getEntity(message.peerId);
                if (hasFirstNameField(entity)) {
                    firstName = entity.firstName;
                    lastName = entity.lastName;
                    username = entity.username;
                } else if (hasTitleField(entity)) {
                    channelTitle = entity.title;
                    username = entity.username;
                }
            } catch (error) {
                console.log('Could not fetch peer (channel) details:', error);
            }
        }
    }

    let name: string | undefined;
    if (firstName && lastName && username) {
        name = `${firstName} ${lastName} (@${username})`;
    } else if (firstName && lastName) {
        name = `${firstName} ${lastName}`;
    } else if (firstName && username) {
        name = `${firstName} (@${username})`;
    } else if (firstName) {
        name = firstName;
    } else if (channelTitle) {
        name = channelTitle;
    } else if (username) {
        name = username;
    }

    return {
        name,
        id: message.fromId ?? message.peerId,
        link: username ? `tg://resolve?domain=${username}` : undefined
    };
}

function isImageMedia(message: Api.Message): boolean {
    if (!message.media) return false;
    if (message.media.className === 'MessageMediaPhoto') return true;
    if (message.media.className === 'MessageMediaDocument') {
        const doc = (message.media as Api.MessageMediaDocument).document as unknown as { mimeType?: string } | undefined;
        return !!doc?.mimeType && doc.mimeType.startsWith('image/');
    }
    return false;
}

async function extractPhotoFromMessage(message: Api.Message, client: TelegramClient, slug: string) {
    if (!isImageMedia(message)) return undefined;

    try {
        console.log("extracting photo from message", message.id)
        // const photo = message.media.photo as tl.Api.Photo;
        const imageBuffer = await client.downloadMedia(message, {
            // thumb: photo?.sizes[photo.sizes.length - 1], // use second biggest photo
        });

        const resizedBuffer = await resizeCoverImage(imageBuffer!)
        const hash = await calculatePhash(resizedBuffer)
        console.log("Uploading resized file to Cloudinary:", `${slug}/${hash}`);
        const result = await cloudinary.uploadImage(resizedBuffer, slug, hash, cloudinary.loadCreds());

        console.log("Successfully uploaded photo to cloudinary:", result.secure_url);
        return result.secure_url;
    } catch (error) {
        console.error("Error extracting photo from message", message.id, ":", error);
        if (error.message.includes("FILE_REFERENCE_EXPIRED")) {
            throw new Error("telegram file reference expired. This happens sometimes. We quit processing the group. FATAL->EXIT");
        }

        // Provide more specific error information
        if (error instanceof Error) {
            console.error("Error details:", {
                message: error.message,
                name: error.name,
                // @ts-expect-error - cloudinary error might have http_code
                http_code: error.http_code
            });
        }

        return undefined;
    }
}



// Returns a resized image buffer for a Telegram photo message
async function getResizedImageBufferFromMessage(message: Api.Message, client: TelegramClient): Promise<Buffer | undefined> {
    if (!isImageMedia(message)) return undefined;

    try {
        const imageBuffer = await client.downloadMedia(message, {});
        if (!imageBuffer) return undefined;
        const resizedBuffer = await resizeCoverImage(imageBuffer);
        return resizedBuffer;
    } catch (error) {
        console.error("Error downloading media from message", message.id, ":", error);
        if (error.message.includes("FILE_REFERENCE_EXPIRED")) {
            throw new Error("telegram file reference expired. This happens sometimes. We quit processing the group. FATAL->EXIT");
        }
        throw error;
    }
}

// Returns a data URL for AI analysis without uploading to Cloudinary
async function getImageDataUrlFromMessage(message: Api.Message, client: TelegramClient): Promise<string | undefined> {
    try {
        const resized = await getResizedImageBufferFromMessage(message, client);
        if (!resized) return undefined;
        const base64 = Buffer.from(resized).toString('base64');
        return `data:image/jpeg;base64,${base64}`;
    } catch (err) {
        console.error("Failed to create data URL from message", message.id, err);
        if (err instanceof Error && err.message.includes("FATAL->EXIT")) {
            throw err;
        }
        return undefined;
    }
}

// Find adjacent image messages by same author within time window without text in between
async function findAdjacentImageMessages(
    currentMessage: Api.Message,
    allMessages: Api.Message[],
): Promise<{ messages: Api.Message[]; messageIds: number[] }> {
    const adjacentMessages: Api.Message[] = [];
    const messageIds: number[] = [];
    const currentAuthorId = getTelegramOriginalAuthorId(currentMessage);
    if (!currentAuthorId) return { messages: adjacentMessages, messageIds };

    const currentMessageTime = currentMessage.date;
    const timeWindowSeconds = 300; // 5 minutes before/after

    console.log(`Looking for adjacent images from user ${currentAuthorId} around message ${currentMessage.id}`);

    const sortedMessages = [...allMessages].sort((a, b) => a.date - b.date);
    const currentMessageIndex = sortedMessages.findIndex(msg => msg.id === currentMessage.id);
    if (currentMessageIndex === -1) return { messages: adjacentMessages, messageIds };

    for (const message of allMessages) {
        const messageAuthorId = getTelegramOriginalAuthorId(message);
        if (messageAuthorId !== currentAuthorId) continue;

        const timeDiff = Math.abs(message.date - currentMessageTime);
        if (timeDiff > timeWindowSeconds) continue;

        if (isImageMedia(message)) {
            const messageIndex = sortedMessages.findIndex(msg => msg.id === message.id);
            if (messageIndex === -1) continue;

            const hasText = hasTextMessagesBetween(
                sortedMessages,
                currentMessageIndex,
                messageIndex,
                currentAuthorId
            );
            if (hasText) {
                console.log(`Skipping image from message ${message.id}: text message found between event and image`);
                continue;
            }

            adjacentMessages.push(message);
            messageIds.push(message.id);
            console.log(`Found adjacent image (message ${message.id}, time diff: ${timeDiff}s)`);
        }
    }

    return { messages: adjacentMessages, messageIds };
}

// Collect adjacent images as data URLs (no upload). Mirrors time/author filtering logic
async function collectAdjacentImageDataUrls(
    currentMessage: Api.Message,
    allMessages: Api.Message[],
    client: TelegramClient,
): Promise<{ imageDataUrls: string[]; messageIds: number[] }> {
    const { messages, messageIds } = await findAdjacentImageMessages(currentMessage, allMessages);
    const imageDataUrls: string[] = [];
    for (const message of messages) {
        try {
            const dataUrl = await getImageDataUrlFromMessage(message, client);
            if (dataUrl) imageDataUrls.push(dataUrl);
        } catch (error) {
            console.error(`Error getting data URL from message ${message.id}:`, error);
            if (error instanceof Error && error.message.includes("FATAL->EXIT")) {
                throw error;
            }
        }
    }
    return { imageDataUrls, messageIds };
}

async function extractAdjacentImagesWithIds(
    currentMessage: Api.Message,
    allMessages: Api.Message[],
    client: TelegramClient,
    slug: string
): Promise<{ imageUrls: string[]; messageIds: number[] }> {
    const imageUrls: string[] = [];
    const { messages, messageIds } = await findAdjacentImageMessages(currentMessage, allMessages);
    for (const message of messages) {
        try {
            const imageUrl = await extractPhotoFromMessage(message, client, slug);
            if (imageUrl) imageUrls.push(imageUrl);
        } catch (error) {
            console.error(`Error extracting adjacent photo from message ${message.id}:`, error);
            if (error instanceof Error && error.message.includes("FATAL->EXIT")) {
                throw error;
            }
        }
    }
    return { imageUrls, messageIds };
}

/**
 * Extracts adjacent text messages that might contain additional event details
 */
async function extractAdjacentTextMessages(
    currentMessage: Api.Message,
    allMessages: Api.Message[]
): Promise<{ textMessages: string[]; messageIds: number[] }> {
    const textMessages: string[] = [];
    const messageIds: number[] = [];
    const currentAuthorId = getTelegramOriginalAuthorId(currentMessage);
    if (!currentAuthorId) return { textMessages, messageIds };

    const currentMessageTime = currentMessage.date;
    const timeWindowSeconds = 300; // 5 minutes before/after

    console.log(`Looking for adjacent text messages from user ${currentAuthorId} around message ${currentMessage.id}`);

    // Sort messages by timestamp
    const sortedMessages = [...allMessages].sort((a, b) => a.date - b.date);
    const currentMessageIndex = sortedMessages.findIndex(msg => msg.id === currentMessage.id);

    if (currentMessageIndex === -1) {
        console.log("Could not find current message in sorted list");
        return { textMessages, messageIds };
    }

    for (const message of allMessages) {
        const messageAuthorId = getTelegramOriginalAuthorId(message);
        if (messageAuthorId !== currentAuthorId) continue;

        const timeDiff = Math.abs(message.date - currentMessageTime);
        if (timeDiff > timeWindowSeconds) continue;

        // Skip the current message itself
        if (message.id === currentMessage.id) continue;

        // Look for text messages (no media or short captions)
        if (!message.media || (message.message && message.message.length > 10)) {
            const messageText = message.message || '';
            if (messageText.trim().length > 0) {
                const messageHtml = resolveTelegramFormattingToHtml(messageText, message.entities);
                textMessages.push(messageHtml);
                messageIds.push(message.id);
                console.log(`Found adjacent text message: "${messageText.substring(0, 50)}..." (message ${message.id}, time diff: ${timeDiff}s)`);
            }
        }
    }

    return { textMessages, messageIds };
}

function hasTextMessagesBetween(
    sortedMessages: Api.Message[],
    eventIndex: number,
    imageIndex: number,
    authorId: string
): boolean {
    const startIndex = Math.min(eventIndex, imageIndex);
    const endIndex = Math.max(eventIndex, imageIndex);

    // Check messages between event and image (exclusive of both endpoints)
    for (let i = startIndex + 1; i < endIndex; i++) {
        const message = sortedMessages[i];
        const messageAuthorId = getTelegramOriginalAuthorId(message);

        // Only consider messages from the same author
        if (messageAuthorId !== authorId) continue;

        // Check if this message contains meaningful text
        if (message.message && message.message.trim().length > 30) {
            console.log(`Found text message between event and image: "${message.message.substring(0, 50)}..."`);
            return true;
        }
    }

    return false;
}



async function extractEventDataFromImageMessage(message: Api.Message, chatId: string, client: TelegramClient, allMessages: Api.Message[]): Promise<{ event: InsertEvent; adjacentMessageIds: number[] } | undefined> {
    if (message.media?.className !== 'MessageMediaPhoto') return undefined;

    console.log("Processing image-only message for event data:", message.id);

    const imageDataUrl = await getImageDataUrlFromMessage(message, client);
    if (!imageDataUrl) {
        console.log("Could not extract image from message:", message.id);
        return undefined;
    }

    const { textMessages: adjacentTextMessages, messageIds: adjacentTextMessageIds } = await extractAdjacentTextMessages(message, allMessages);
    const combinedText = adjacentTextMessages.length > 0 ? adjacentTextMessages.join('\n\n') : '';

    await sleep(1000)
    const aiAnswer = await aiExtractEventData(combinedText, new Date(message.date * 1000), [imageDataUrl]);

    const base = await validateAndBuildEventBase({
        aiAnswer,
        message,
        client,
        chatId,
        descriptionOriginal: combinedText || aiAnswer.description || ''
    });
    if (!base) return undefined;

    const { baseEvent, slug } = base;

    const mainImageUrl = await extractPhotoFromMessage(message, client, slug);
    const { imageUrls: additionalImageUrls, messageIds: adjacentImageMessageIds } = await extractAdjacentImagesWithIds(message, allMessages, client, slug);
    const allImageUrls = Array.from(new Set([...(mainImageUrl ? [mainImageUrl] : []), ...additionalImageUrls]));

    baseEvent.imageUrls = allImageUrls;
    const mergedEvent = await mergeWithExistingEventBySlug(baseEvent);

    const allAdjacentMessageIds = [...adjacentTextMessageIds, ...adjacentImageMessageIds];
    return { event: mergedEvent, adjacentMessageIds: allAdjacentMessageIds };
}

async function extractEventDataFromMessage(message: Api.Message, chatId: string, client: TelegramClient, allMessages: Api.Message[]): Promise<{ event: InsertEvent; adjacentMessageIds: number[] } | undefined> {
    const msgHtml = resolveTelegramFormattingToHtml(message.message, message.entities);
    console.log("extracting event data from message", message.id)

    const { textMessages: adjacentTextMessages, messageIds: adjacentTextMessageIds } = await extractAdjacentTextMessages(message, allMessages);
    const { imageDataUrls: adjacentImageUrls } = await collectAdjacentImageDataUrls(message, allMessages, client);

    const combinedText = [msgHtml, ...adjacentTextMessages].join('\n\n');

    await sleep(1000)
    const aiAnswer = await aiExtractEventData(combinedText, new Date(message.date * 1000), adjacentImageUrls);

    const base = await validateAndBuildEventBase({
        aiAnswer,
        message,
        client,
        chatId,
        descriptionOriginal: combinedText
    });
    if (!base) return undefined;

    const { baseEvent, slug } = base;

    const { imageUrls, messageIds: adjacentImageMessageIds } = await extractAdjacentImagesWithIds(message, allMessages, client, slug);
    baseEvent.imageUrls = imageUrls;
    const mergedEvent = await mergeWithExistingEventBySlug(baseEvent);

    const allAdjacentMessageIds = [...adjacentTextMessageIds, ...adjacentImageMessageIds];
    return { event: mergedEvent, adjacentMessageIds: allAdjacentMessageIds };
}

function mergeDuplicateEvents(events: InsertEvent[]): InsertEvent[] {
    const uniqueEvents = new Map<string, InsertEvent>();

    events.forEach(event => {
        const existing = uniqueEvents.get(event.slug);

        if (existing) {
            // Take the longest description
            const description = (event.description?.length ?? 0) > (existing.description?.length ?? 0)
                ? event.description
                : existing.description;

            // Merge imageUrls
            const imageUrls = Array.from(new Set([
                ...(existing.imageUrls ?? []),
                ...(event.imageUrls ?? [])
            ]));

            // Merge tags
            const tags = Array.from(new Set([
                ...(existing.tags ?? []),
                ...(event.tags ?? [])
            ]));

            // Merge telegramRoomIds
            const telegramRoomIds = Array.from(new Set([
                ...(existing.telegramRoomIds ?? []),
                ...(event.telegramRoomIds ?? [])
            ]));

            // Update the existing event with merged data
            uniqueEvents.set(event.slug, {
                ...existing,
                description,
                imageUrls,
                tags,
                telegramRoomIds
            });
        } else {
            uniqueEvents.set(event.slug, event);
        }
    });

    return Array.from(uniqueEvents.values());
}

async function mergeWithExistingEventBySlug(eventRow: InsertEvent): Promise<InsertEvent> {
    const existingEvent = await db.query.events.findFirst({ where: eq(s.events.slug, eventRow.slug) });
    if (!existingEvent) return eventRow;

    const merged: InsertEvent = { ...eventRow };
    if ((existingEvent.description?.length ?? 0) > (merged.description?.length ?? 0)) {
        console.log(`existing description is longer than new one, not updating description for ${eventRow.slug}`)
        merged.description = existingEvent.description ?? undefined
    }
    merged.imageUrls = Array.from(new Set([...(existingEvent.imageUrls ?? []), ...(merged.imageUrls ?? [])]));
    return merged;
}

async function normalizeAddress(args: { aiAnswer: AiAnswerMinimal; chatId: string }): Promise<string[] | undefined> {
    const { aiAnswer, chatId } = args;
    if (!aiAnswer.address && !aiAnswer.venue && !aiAnswer.city) {
        const chatConfig = await db.query.telegramScrapingTargets.findFirst({ where: eq(s.telegramScrapingTargets.roomId, chatId) })
        if (chatConfig?.defaultAddress?.length) {
            aiAnswer.address = chatConfig.defaultAddress.join(',')
        } else {
            return undefined;
        }
    }
    let addressArr = aiAnswer.address ? aiAnswer.address.split(',') : [];
    if (aiAnswer.venue && !aiAnswer.address?.includes(aiAnswer.venue)) addressArr = [aiAnswer.venue, ...addressArr];
    if (aiAnswer.city && !aiAnswer.address?.includes(aiAnswer.city)) addressArr = [...addressArr, aiAnswer.city];
    return addressArr;
}

async function validateAndBuildEventBase(args: {
    aiAnswer: AiAnswerMinimal,
    message: Api.Message,
    client: TelegramClient,
    chatId: string,
    descriptionOriginal: string,
}): Promise<{ baseEvent: InsertEvent; slug: string } | undefined> {
    const { aiAnswer, message, client, chatId, descriptionOriginal } = args;

    if (aiAnswer.existingSource) {
        console.log(`Skipping event - existing source detected: ${aiAnswer.existingSource}`);
        return undefined;
    }
    if (!aiAnswer.hasEventData) {
        console.log(`Skipping event - no event data detected`);
        return undefined;
    }
    if (!aiAnswer.name) {
        console.log(`Skipping event - no name provided`);
        return undefined;
    }
    if (!aiAnswer.startDate) {
        console.log(`Skipping event - no start date provided`);
        return undefined;
    }

    const startAt = new Date(aiAnswer.startDate);
    if (startAt.getTime() < Date.now()) {
        console.log(`Skipping event - start date is in the past: ${startAt.toISOString()}`);
        return undefined;
    }

    const addressArr = await normalizeAddress({ aiAnswer, chatId });
    if (!addressArr || addressArr.length === 0) {
        console.log(`Skipping event - no address found`);
        return undefined;
    }

    const coords = await geocodeAddressCached(addressArr, googleMapsApiKey || '')
    let contact = parseTelegramContact(aiAnswer.contact);
    const telegramAuthor = await getTelegramEventOriginalAuthor(message, client);
    if (aiAnswer.contactAuthorForMore) {
        contact = telegramAuthor?.link
        if (!contact) {
            console.log(`Skipping event - contact author requested but no telegram author link available`);
            return undefined;
        }
    }

    const endAt = aiAnswer.endDate ? new Date(aiAnswer.endDate) : null
    const name = aiAnswer.name.trim()
    const slug = generateSlug({ name, startAt, endAt: endAt || undefined })

    const baseEvent: InsertEvent = {
        name,
        imageUrls: [],
        startAt,
        endAt,
        address: addressArr,
        tags: aiAnswer.tags,
        latitude: coords?.lat,
        longitude: coords?.lng,
        price: aiAnswer.price,
        description: aiAnswer.description,
        descriptionOriginal,
        summary: aiAnswer.summary,
        host: telegramAuthor?.name,
        hostLink: telegramAuthor?.link,
        sourceUrl: aiAnswer.url,
        messageSenderId: getTelegramOriginalAuthorId(message),
        contact,
        source: "telegram",
        slug,
    } satisfies InsertEvent;

    return { baseEvent, slug };
}

/**
 * Processes a single scraping target and returns the result
 */
async function processScrapingTarget(target: TelegramScrapingTarget, client: TelegramClient): Promise<{ success: boolean; error?: Error; target: TelegramScrapingTarget }> {
    let resolvedRoomId = target.roomId;
    try {
        console.log(`\n#### Processing target: ${target.roomId}`);

        // resolve roomId from name 
        if (target.roomId.includes("resolveName:")) {
            const chatName = target.roomId.split(":")[1].trim()
            const chatId = await getChatIdByName(client, chatName);
            if (!chatId) {
                console.error(`No chat found for name "${chatName}"`);
                return { success: false, error: new Error(`No chat found for name "${chatName}"`), target };
            }
            resolvedRoomId = chatId;
            console.log(`resolved "${chatName}" to ${chatId}`)
        }

        const entity = await client.getEntity(resolvedRoomId);
        const entityName = getEntityName(entity);
        console.log(`Target name: ${entityName}`);

        if (isForum(entity) && target.topicIds.length === 0) {
            throw new Error(`FATAL->EXIT: ${target.roomId} (${entityName}) is a forum but no topicIds are set`);
        }
        if (!isForum(entity) && target.topicIds.length > 0) {
            throw new Error(`FATAL->EXIT: ${target.roomId} (${entityName}) is not a forum but topicIds are set`);
        }

        let messages: Api.Message[] = [];
        const limit = 50;
        // "-1" signals that we want to process messages from all topics in a forum group. We have to optin to this.
        if (target.topicIds.length > 0 && Number(target.topicIds[0]) !== -1) {
            for (const topicId of target.topicIds) {
                console.log(`Getting messages for topic ${topicId}`);
                messages = messages.concat(await client.getMessages(entity, {
                    replyTo: Number(topicId),
                    limit,
                    ...(target.lastMessageId ? { minId: Number(target.lastMessageId) } : {}),
                }));
            }
        } else {
            messages = await client.getMessages(entity, {
                limit,
                ...(target.lastMessageId ? { minId: Number(target.lastMessageId) } : {}),
            });
        }
        console.log(`Found ${messages.length} new messages`);

        if (messages.length > 0) {
            const { scrapedEventsCount } = await processMessages(messages, resolvedRoomId, client);
            messages.sort((a, b) => b.id - a.id); // necessary cuz we are pulling from multiple topics, highest id first
            const latestMsgId = BigInt(messages[0].id);
            const latestMsgTime = new Date(messages[0].date * 1000);
            const totalMessagesConsumed = target.messagesConsumed + messages.length;

            console.log(`Messages consumed: ${messages.length} (Total: ${totalMessagesConsumed})`);
            console.log(`New Last message ID: ${latestMsgId} (${latestMsgTime})`);

            await db.update(s.telegramScrapingTargets)
                .set({
                    roomId: resolvedRoomId,
                    name: entityName,
                    messagesConsumed: totalMessagesConsumed,
                    lastMessageId: latestMsgId,
                    lastMessageTime: latestMsgTime,
                    lastError: null,
                    scrapedEvents: target.scrapedEvents + scrapedEventsCount,
                    lastRunFinishedAt: new Date(),
                })
                .where(eq(s.telegramScrapingTargets.roomId, target.roomId));
        } else {
            console.log(`No new messages for target ${target.roomId}`);
            await db.update(s.telegramScrapingTargets)
                .set({
                    name: entityName,
                    lastRunFinishedAt: new Date(),
                    lastError: null,
                })
                .where(eq(s.telegramScrapingTargets.roomId, target.roomId));
        }

        return { success: true, target };
    } catch (error) {
        console.error(`❌ Error processing target ${target.roomId}:`, error);

        await db.update(s.telegramScrapingTargets)
            .set({ lastError: error.message, lastRunFinishedAt: new Date() })
            .where(eq(s.telegramScrapingTargets.roomId, target.roomId));

        if (error instanceof Error && error.message.includes("FATAL->EXIT")) {
            throw error;
        }

        return { success: false, error: error as Error, target };
    }
}

/**
 * Processes messages and returns the newest message ID
 */
async function processMessages(messages: TotalList<Api.Message>, chatId: string, client: TelegramClient) {
    let events: InsertEvent[] = [];
    const processedMessageIds = new Set<number>(); // Track processed messages to avoid duplicates

    // Messages are returned in reverse chronological order (newest first) We want to process them in chronological order (oldest first)
    const sortedMessages = [...messages].reverse();
    const allMessages = [...messages]; // Keep original list for adjacent message lookup

    for (const message of sortedMessages) {
        // Skip if this message has already been processed as part of another event
        if (processedMessageIds.has(message.id)) {
            console.log(`Skipping already processed message ${message.id}`);
            continue;
        }

        console.log(`msg#${message.id}: ${message.className} ${message.classType} ${message.media?.className}`);
        const msg = message.message;

        // Handle text messages with event data
        if (msg && msg.length > 30) {
            const result = await extractEventDataFromMessage(message, chatId, client, allMessages);
            if (result) {
                events.push(result.event);
                // Mark this message and its adjacent images as processed
                processedMessageIds.add(message.id);
                result.adjacentMessageIds.forEach(id => processedMessageIds.add(id));
            }
        }
        // Handle image-only messages that might contain event flyers
        else if (isImageMedia(message) && (!msg || msg.length <= 30)) {
            console.log(`Processing image-only message ${message.id} for potential event data`);
            const result = await extractEventDataFromImageMessage(message, chatId, client, allMessages);
            if (result) {
                events.push(result.event);
                // Mark this message and its adjacent images as processed
                processedMessageIds.add(message.id);
                result.adjacentMessageIds.forEach(id => processedMessageIds.add(id));
            }
        }
        // Log other photo messages that are part of text messages
        else if (isImageMedia(message)) {
            console.log(`${message.media?.className} from ${getTelegramOriginalAuthorId(message)}`);
        }
    }

    events = mergeDuplicateEvents(events);
    events.forEach(x => x.telegramRoomIds = Array.from(new Set([chatId, ...(x.telegramRoomIds ?? [])])))

    if (events.length > 0) {
        console.log("inserting into db:", events)
        console.log("inserting these slugs:", events.map(e => e.slug))
        await insertEvents(events);
    } else {
        console.log("no events to insert")
    }

    // return newest message id and time
    return {
        scrapedEventsCount: events.length,
    }
}

async function getChatIdByName(client: TelegramClient, name: string) {
    const dialogs = await client.getDialogs({});
    for (const dialog of dialogs) {
        if (dialog.name === name) {
            return dialog.id?.toString();
        }
    }
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

/**
 * Prompts user for input and returns a promise
 */
const askQuestion = (question: string): Promise<string> => {
    return new Promise((resolve) => rl.question(question, resolve));
};

/**
 * Gets entity name from Telegram entity
 */
const getEntityName = (entity: unknown): string => {
    const entityObj = entity as Record<string, unknown>;
    if ('title' in entityObj) {
        return entityObj.title as string;
    } else if ('username' in entityObj) {
        return (entityObj.username as string) || 'Unknown';
    } else if ('firstName' in entityObj) {
        return `${entityObj.firstName as string} ${(entityObj.lastName as string) || ''}`.trim();
    }
    return 'Unknown';
};

function isForum(entity: Entity) {
    return entity.className === 'Channel' && entity.forum;
}

const client = new TelegramClient(sessionAuthKey, apiId, apiHash, {
    connectionRetries: 5,
});
await client.start({
    phoneNumber: async () => await askQuestion("Please enter your number: "),
    password: async () => await askQuestion("Please enter your password: "),
    phoneCode: async () => await askQuestion("Please enter the code you received: "),
    onError: (err) => console.log(err),
});

if (!sessionAuthKeyString) {
    console.warn("New session auth key:", client.session.save())
}

console.log("Connected to Telegram servers");

/**
 * Processes targets with a truly parallel worker pool that maintains exactly 3 concurrent workers
 * Workers are dynamically spawned and replaced to ensure continuous processing
 */
async function processTargetsWithWorkerPool(targets: TelegramScrapingTarget[], client: TelegramClient): Promise<Error[]> {
    const fatalErrors: Error[] = [];
    const MAX_CONCURRENT = 3;
    const targetQueue = [...targets]; // Copy targets to a queue
    const activeWorkers = new Set<Promise<void>>();
    let completedCount = 0;
    let workerId = 0;

    console.log(`\n🚀 Starting dynamic worker pool with ${MAX_CONCURRENT} concurrent workers for ${targets.length} targets`);

    // Helper function to spawn a new worker
    const spawnWorker = (): Promise<void> => {
        const currentWorkerId = ++workerId;
        console.log(`🆕 Spawning worker #${currentWorkerId}`);

        const workerPromise = createWorker(currentWorkerId, targetQueue, client, fatalErrors, () => {
            completedCount++;
            console.log(`📊 Progress: ${completedCount}/${targets.length} targets completed`);
        });

        // When worker completes, remove it from active set and spawn replacement if needed
        workerPromise.finally(() => {
            activeWorkers.delete(workerPromise);
            console.log(`🏁 Worker #${currentWorkerId} finished. Active workers: ${activeWorkers.size}`);

            // Spawn replacement worker if there are still targets and we're below max concurrent
            if (targetQueue.length > 0 && activeWorkers.size < MAX_CONCURRENT) {
                const newWorker = spawnWorker();
                activeWorkers.add(newWorker);
            }
        });

        return workerPromise;
    };

    // Spawn initial workers
    for (let i = 0; i < Math.min(MAX_CONCURRENT, targets.length); i++) {
        const worker = spawnWorker();
        activeWorkers.add(worker);
    }

    // Wait for all work to complete by monitoring the queue and active workers
    while (targetQueue.length > 0 || activeWorkers.size > 0) {
        if (activeWorkers.size > 0) {
            // Wait for at least one worker to complete, then check if we need to spawn more
            await Promise.race(Array.from(activeWorkers));
        }

        // Small delay to prevent tight polling
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`\n✅ Completed processing all ${targets.length} targets`);
    return fatalErrors;
}

/**
 * Creates a worker that continuously processes targets from the queue until empty
 * This worker processes ONE target at a time and immediately looks for the next one
 */
async function createWorker(
    workerId: number,
    targetQueue: TelegramScrapingTarget[],
    client: TelegramClient,
    fatalErrors: Error[],
    onTargetComplete: () => void
): Promise<void> {
    console.log(`🔧 Worker #${workerId} started`);

    while (targetQueue.length > 0) {
        // Atomically get next target from queue
        const target = targetQueue.shift();
        if (!target) {
            // Queue became empty while we were checking, exit gracefully
            break;
        }

        const remainingTargets = targetQueue.length;
        console.log(`\n🔄 Worker #${workerId} processing: ${target.roomId} (${remainingTargets} remaining)`);

        try {
            const result = await processScrapingTarget(target, client);

            if (!result.success && result.error && result.error.message.includes("FATAL->EXIT")) {
                fatalErrors.push(result.error);
            }
        } catch (error) {
            console.error(`❌ Worker #${workerId} error for target ${target.roomId}:`, error);
            if (error instanceof Error && error.message.includes("FATAL->EXIT")) {
                fatalErrors.push(error);
            }
        }

        onTargetComplete();
        console.log(`✅ Worker #${workerId} completed: ${target.name} (${target.roomId})`);
    }

    console.log(`🛑 Worker #${workerId} exiting - no more targets in queue`);
}

try {
    // Get all scraping targets from database
    const scrapingTargets = await db.query.telegramScrapingTargets.findMany();
    if (scrapingTargets.length === 0) {
        console.log("No scraping targets found in database");
        process.exit(0);
    }
    scrapingTargets.sort(() => Math.random() - 0.5); // Shuffle scrapingTargets randomly

    // Process targets with worker pool
    const fatalErrors = await processTargetsWithWorkerPool(scrapingTargets, client);

    // in the end log fatal erors and exit so sam can have a look at them
    if (fatalErrors.length > 0) {
        console.error(`\n❌ Fatal errors occurred:`, fatalErrors.map(e => e.message));
        process.exit(1);
    }

} catch (error) {
    console.error("Error processing scraping targets:", error);
    throw error;
}

rl.close(); // Close the readline interface
process.exit(0);