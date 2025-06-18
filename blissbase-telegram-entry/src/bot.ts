import { Context } from 'telegraf';
import type { MessageEntity } from 'telegraf/types';
import { aiExtractEventData } from './ai';

export async function handleMessage(ctx: Context, payloadJson: any) {
    console.log("message received", ctx.message);
    if (!ctx.message) return;

    const isGroup =
        ctx.message?.chat.type === "group" || ctx.message?.chat.type === "supergroup"
    try {
        let msgText = "";
        let msgEntities: MessageEntity[] = [];

        if ('text' in ctx.message) {
            msgText = ctx.message.text;
            msgEntities = ctx.message.entities ?? [];
        } else if ('caption' in ctx.message && ctx.message.caption) {
            msgText = ctx.message.caption;
            msgEntities = ctx.message.caption_entities ?? [];
        }

        const msgTextHtml = resolveTelegramFormattingToHtml(msgText, [...msgEntities])
        const aiAnswer = await wrapInTyping(ctx, () => aiExtractEventData(msgTextHtml), !isGroup)

        const res = await fetch("https://www.blissbase.app/telegram/message", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                aiAnswer,
                msgTextHtml,
                telegramPayload: payloadJson,
            })
        })

        if (!res.ok) {
            console.error("Failed to call vercel function", {
                status: res.status,
                statusText: res.statusText,
                body: await res.text(),
            })
        }
    } catch (error) {
        console.error(error)
        try {
            if (!isGroup) {
                await reply(ctx, "⚠️ Die Nachricht konnte nicht verarbeitet werden versuche es später erneut.\n\nFehler: " + error, msgId)
            }
        } catch { /* ignore */ }
    }
}

async function reply(ctx: Context, text: string) {
    if (ctx.message?.chat.type === "group" || ctx.message?.chat.type === "supergroup") {
        return // do not reply in groups
    }
    await ctx.reply(text)
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
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5 seconds
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