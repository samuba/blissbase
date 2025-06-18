import { Telegraf, Context } from "telegraf";
import { anyOf, message } from "telegraf/filters";
import { Update } from "telegraf/types";
import type { MessageEntity } from 'telegraf/types';
import { aiExtractEventData } from './ai';

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);

		const data = await request.json() as Update

		bot.on(anyOf(message('text'), message('forward_origin')), async (ctx) => {
			await handleMessage(ctx, data)
		})

		await bot.handleUpdate(data)

		return new Response('OK');
	},
} satisfies ExportedHandler<Env>;


export async function handleMessage(ctx: Context, payloadJson: unknown) {
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

		let imageUrl: string | undefined;
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

		console.log("aiAnswer", aiAnswer)

		const res = await fetch("https://www.blissbase.app/telegram/message", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				telegramPayload: payloadJson,
				msgTextHtml,
				imageUrl,
				aiAnswer,
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
				await reply(ctx, "⚠️ Die Nachricht konnte nicht verarbeitet werden versuche es später erneut.\n\nFehler: " + error)
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
	// Early return for no entities
	if (!entities.length) {
		return lineBreaksToBr(text);
	}

	// Pre-calculate opening and closing tags for all entities to avoid repeated function calls
	const entityTags = new WeakMap<MessageEntity, { opening: string, closing: string }>();

	for (const entity of entities) {
		const content = text.slice(entity.offset, entity.offset + entity.length);
		entityTags.set(entity, {
			opening: getOpeningTag(entity, content),
			closing: getClosingTag(entity.type)
		});
	}

	// Pre-group entities by their start and end positions for faster lookup
	const entitiesByStartPos = new Map<number, MessageEntity[]>();
	const entitiesByEndPos = new Map<number, MessageEntity[]>();
	const changePositions = new Set<number>();

	for (const entity of entities) {
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
	const activeEntities: MessageEntity[] = [];
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

	function getOpeningTag(entity: MessageEntity, content: string): string {
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