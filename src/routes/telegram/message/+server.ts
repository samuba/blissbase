import type { RequestHandler } from '@sveltejs/kit';
import { bot, handleMessage, messageFilters } from './bot';
import { waitUntil } from '@vercel/functions';
import type { Update } from 'telegraf/types';
import type { MsgAnalysisAnswer } from './ai';

export const POST: RequestHandler = async ({ request }) => {
    try {
        const data = await request.json() as { telegramPayload: Update, aiAnswer: MsgAnalysisAnswer, msgTextHtml: string };
        console.log("telegram message from cloudflare", data);

        bot.on(messageFilters, async (ctx) => {
            return await handleMessage(ctx, { aiAnswer: data.aiAnswer, msgTextHtml: data.msgTextHtml })
        })

        waitUntil(bot.handleUpdate(data.telegramPayload))
    } catch (error) {
        console.error(error);
    }

    return new Response('OK', { status: 200 });
};
