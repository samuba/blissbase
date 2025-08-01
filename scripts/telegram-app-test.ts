import { Api, TelegramClient, tl } from "telegram";
import { StringSession } from "telegram/sessions";
import readline from "readline";
import 'dotenv/config'
import { db, eq, s } from '../src/lib/server/db';
import { InsertEvent } from "../src/lib/types";
import { generateSlug, parseTelegramContact } from "../src/lib/common";
import { geocodeAddressCached } from "../src/lib/server/google";
import { insertEvents } from '../src/lib/server/events';
import { TotalList } from "telegram/Helpers";
import { aiExtractEventData } from "../blissbase-telegram-entry/src/ai";
import { v2 as cloudinary } from 'cloudinary';
import fs from "fs";



const apiId = Number(process.env.TELEGRAM_APP_ID);
const apiHash = process.env.TELEGRAM_APP_HASH!;
const stringSession = new StringSession(process.env.TELEGRAM_APP_SESSION!);

cloudinary.config({
    secure: true,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
});

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
            case "text_link": return `<a href="${entity.url}">`;
            case "text_mention": return `<a href="tg://user?id=${entity.user?.id}">`;
            case "mention": return `<a href="tg://user?id=${content.slice(1)}">`;
            case "hashtag": return `<a href="tg://search?query=${encodeURIComponent(content)}">`;
            case "cashtag": return `<a href="tg://search?query=${encodeURIComponent(content)}">`;
            case "bot_command": return '<code>';
            case "url": return `<a href="${content}">`;
            case "email": return `<a href="mailto:${content}">`;
            case "phone_number": return `<a href="tel:${content}">`;
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
    }
}

async function getTelegramEventOriginalAuthor(message: Api.Message, client: TelegramClient) {
    if (!message) return undefined;

    let username: string | undefined;
    let firstName: string | undefined;
    let lastName: string | undefined;

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
                if (user && 'firstName' in user) {
                    firstName = user.firstName;
                    lastName = user.lastName;
                    username = user.username;
                }
            } catch (error) {
                console.log('Could not fetch user details:', error);
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
    } else if (username) {
        name = username;
    }

    return {
        name,
        id: message.fromId,
        link: username ? `tg://resolve?domain=${username}` : undefined
    };
}

async function extractPhotoFromMessage(message: Api.Message, client: TelegramClient, slug: string) {
    if (message.media?.className !== 'MessageMediaPhoto') return undefined;

    try {
        console.log("extracting photo from message", message.id)
        // const photo = message.media.photo as tl.Api.Photo;
        const filePath = (await client.downloadMedia(message, {
            outputFile: `./${message.photo?.id}`,
            // thumb: photo?.sizes[photo.sizes.length - 1], // use second biggest photo
        })) as string;
        if (!filePath) return undefined;

        const result = await cloudinary.uploader.upload(filePath, {
            resource_type: "image",
            public_id: `${slug}-${message.photo?.id}`,
            access_mode: "public",
        });
        console.log("extracted photo into cloudinary", result.secure_url)
        await Bun.file(filePath).delete()
        return result.secure_url;
    } catch (error) {
        console.error("Error extracting photo from message", error)
        return undefined;
    }
}

async function extractEventDataFromMessage(message: Api.Message, chatId: bigint, client: TelegramClient) {
    const msgHtml = resolveTelegramFormattingToHtml(message.message, message.entities);
    console.log("extracting event data from message", message.id)
    const aiAnswer = await aiExtractEventData(msgHtml);

    if (aiAnswer.existingSource) {
        console.log("event from existing source: ", msgHtml)
        return undefined;
    }
    if (!aiAnswer.hasEventData) {
        console.log("No event data found in message: ", msgHtml)
        return undefined;
    }
    if (!aiAnswer.name) {
        console.log("No event name found in message: ", msgHtml)
        return undefined;
    }
    if (!aiAnswer.startDate) {
        console.log("No event start date found in message: ", msgHtml)
        return undefined;
    }
    if (!aiAnswer.address && !aiAnswer.venue && !aiAnswer.city) {
        const chatConfig = await db.query.telegramScrapingTargets.findFirst({ where: eq(s.telegramScrapingTargets.chatId, chatId) })
        if (chatConfig?.defaultAddress?.length) {
            aiAnswer.address = chatConfig.defaultAddress.join(',')
        } else {
            console.log("No event location found", msgHtml)
            return undefined;
        }
    }

    let addressArr = aiAnswer.address ? aiAnswer.address.split(',') : [];
    if (aiAnswer.venue && !aiAnswer.address?.includes(aiAnswer.venue)) addressArr = [aiAnswer.venue, ...addressArr];
    if (aiAnswer.city && !aiAnswer.address?.includes(aiAnswer.city)) addressArr = [...addressArr, aiAnswer.city];

    const coords = await geocodeAddressCached(addressArr, process.env.GOOGLE_MAPS_API_KEY || '')
    let contact = parseTelegramContact(aiAnswer.contact);
    const telegramAuthor = await getTelegramEventOriginalAuthor(message, client);
    if (aiAnswer.contactAuthorForMore) {
        contact = telegramAuthor?.link
        if (!contact) {
            console.log("User wants contact via telegram but has no telegram user name specified", msgHtml)
            return undefined;
        }
    }

    const startAt = new Date(aiAnswer.startDate)
    const endAt = aiAnswer.endDate ? new Date(aiAnswer.endDate) : null
    const name = aiAnswer.name.trim()
    const slug = generateSlug({ name, startAt, endAt: endAt ?? undefined })
    let imageUrls: string[] = []
    const imageUrl = await extractPhotoFromMessage(message, client, slug);
    if (imageUrl) imageUrls = [imageUrl];

    const eventRow = {
        name,
        imageUrls,
        startAt,
        endAt,
        address: addressArr,
        tags: aiAnswer.tags,
        latitude: coords?.lat,
        longitude: coords?.lng,
        price: aiAnswer.price,
        description: aiAnswer.description,
        descriptionOriginal: msgHtml,
        summary: aiAnswer.summary,
        host: telegramAuthor?.name,
        hostLink: telegramAuthor?.link,
        sourceUrl: aiAnswer.url,
        messageSenderId: getTelegramOriginalAuthorId(message),
        contact,
        source: "telegram",
        slug,
    } satisfies InsertEvent

    const existingEvent = await db.query.events.findFirst({ where: eq(s.events.slug, slug) });
    if (existingEvent) {
        // only override description if its longer than the existing one
        if ((existingEvent.description?.length ?? 0) > (eventRow.description?.length ?? 0)) {
            console.log("existing description is longer than new one, not updating description for ", slug)
            eventRow.description = existingEvent.description ?? undefined
        }
        // if no image was provided, use the existing one
        if (eventRow.imageUrls.length === 0 && (existingEvent.imageUrls?.length ?? 0) > 0) {
            eventRow.imageUrls = existingEvent.imageUrls ?? []
        }
    }

    return eventRow;
}

/**
 * Processes messages and returns the newest message ID
 */
async function processMessages(messages: TotalList<Api.Message>, chatId: bigint, client: TelegramClient) {
    const events: InsertEvent[] = [];

    // Messages are returned in reverse chronological order (newest first) We want to process them in chronological order (oldest first)
    const sortedMessages = [...messages].reverse();
    for (const message of sortedMessages) {
        console.log(`msg#${message.id}: ${message.className} ${message.classType} ${message.media?.className}`);
        const msg = message.message;
        if (msg && msg.length > 30) {
            const event = await extractEventDataFromMessage(message, chatId, client);
            if (event) events.push(event);
        }

        if (message.media?.className === 'MessageMediaPhoto') {
            // TODO: donwload photo and upload to cloudinary
            console.log(message.media.photo?.className + " from " + getTelegramOriginalAuthorId(message));
        }
    }


    console.log("inserting into db:", events)
    // await insertEvents(events);

    // return newest message id and time
    return {
        id: BigInt(messages[0].id),
        time: new Date(messages[0].date * 1000),
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

console.log("Loading interactive example...");
const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
});

await client.start({
    phoneNumber: async () => await askQuestion("Please enter your number: "),
    password: async () => await askQuestion("Please enter your password: "),
    phoneCode: async () => await askQuestion("Please enter the code you received: "),
    onError: (err) => console.log(err),
});

console.log("You should now be connected.");

try {
    // Get all scraping targets from database
    const scrapingTargets = await db.query.telegramScrapingTargets.findMany();
    if (scrapingTargets.length === 0) {
        console.log("No scraping targets found in database");
        process.exit(0);
    }

    // Process each target
    for (const target of scrapingTargets) {
        try {
            console.log(`\nProcessing target: ${target.chatId}`);
            const entity = await client.getEntity(Number(target.chatId));
            const entityName = getEntityName(entity);
            console.log(`Target name: ${entityName}`);

            // Get messages newer than the last processed message
            const messages = await client.getMessages(entity, {
                limit: 1,
                ...(target.lastMessageId ? { minId: Number(target.lastMessageId) } : {}),
            });

            console.log(`Found ${messages.length} new messages`);

            if (messages.length > 0) {
                const newestMessage = await processMessages(messages, target.chatId, client);
                const totalMessagesConsumed = target.messagesConsumed + messages.length;

                console.log(`Messages consumed: ${messages.length} (Total: ${totalMessagesConsumed})`);
                console.log(`New Last message ID: ${newestMessage.id} (${newestMessage.time})`);

                // await db.update(s.telegramScrapingTargets)
                //     .set({
                //         name: entityName,
                //         lastMessageId: newestMessageId,
                //         messagesConsumed: totalMessagesConsumed,
                //     })
                //     .where(eq(s.telegramScrapingTargets.chatId, target.chatId));
            } else {
                console.log(`No new messages for target ${target.chatId}`);
            }
        } catch (error) {
            console.error(`❌ Error processing target ${target.chatId}:`, error);
        }
    }

    console.log(`\n✅ Completed processing ${scrapingTargets.length} targets`);
} catch (error) {
    console.error("Error processing scraping targets:", error);
}

rl.close(); // Close the readline interface
process.exit(0);