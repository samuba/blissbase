/**
 * Common stuff for usage in vercel and cloudflare entrypoint
 */

import type { Update } from "telegraf/types";
import { anyOf, channelPost, message } from "telegraf/filters";
import type { MsgAnalysisAnswer } from "../../blissbase-telegram-entry/src/ai";
import type { Context } from "telegraf";
import type { Api } from "telegram";

export const msgFilters = anyOf(
    message('text'),
    message('forward_origin'),
    message('chat_shared'),
    message('forum_topic_created'),
    message('caption'),
    message('caption_entities'),
    message('photo'),
    channelPost('text'),
    channelPost('forward_origin'),
    channelPost('chat_shared'),
    channelPost('forum_topic_created'),
    channelPost('caption'),
    channelPost('caption_entities'),
    channelPost('photo'),
)

export type TelegramCloudflareBody = {
    telegramPayload: Update,
    msgTextHtml: string,
    image: { url: string, id: string } | undefined | null,
    aiAnswer: MsgAnalysisAnswer,
    fromGroup: boolean,
}

function wasMessageForwarded(message: Context['message']): boolean {
    if (!message) return false;
    return 'forward_from' in message || 'forward_origin' in message;
}

export function getTelegramEventOriginalAuthor(message: Context['message']) {
    if (!message) return undefined;

    let username: string | undefined;
    let firstName: string | undefined;
    let lastName: string | undefined;
    let originalAuthorId: number | undefined;

    if (wasMessageForwarded(message)) {
        const msg = message as unknown as {
            forward_from?: { id?: number; username?: string; first_name?: string; last_name?: string };
            forward_origin?: {
                chat?: { id?: number; username?: string; first_name?: string; last_name?: string };
                sender_user?: { id?: number; username?: string; first_name?: string; last_name?: string };
                author_signature?: string;
            };
        };
        originalAuthorId = msg?.forward_from?.id ??
            msg.forward_origin?.sender_user?.id ??
            msg.forward_origin?.chat?.id ??
            message?.from.id
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
        originalAuthorId = message?.from.id;
        firstName = message?.from.first_name;
        lastName = message?.from.last_name;
        username = message?.from.username;
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
        id: originalAuthorId,
        link: username ? `tg://resolve?domain=${username}` : undefined,
        username
    };
}

export function resolveTelegramFormattingToHtml(text: string, entities: Api.TypeMessageEntity[] | undefined): string {
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
            case "text_mention": return `<a href="tg://resolve?domain=${entity.user?.id}" target="_blank">`;
            case "mention": return `<a href="tg://resolve?domain=${content.slice(1)}" target="_blank">`;
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