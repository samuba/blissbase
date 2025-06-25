/**
 * Common stuff for usage in vercel and cloudflare entrypoint
 */

import type { Update } from "telegraf/types";
import { anyOf, channelPost, message } from "telegraf/filters";
import type { MsgAnalysisAnswer } from "../../blissbase-telegram-entry/src/ai";

export const msgFilters = anyOf(
    message('text'),
    message('forward_origin'),
    message('chat_shared'),
    message('forum_topic_created'),
    message('caption'),
    message('caption_entities'),
    channelPost()
)

export type TelegramCloudflareBody = {
    telegramPayload: Update,
    msgTextHtml: string,
    imageUrl: string | undefined | null,
    aiAnswer: MsgAnalysisAnswer,
    fromGroup: boolean,
}