import type { RequestHandler } from '@sveltejs/kit';
import { bot, handleMessage, messageFilters } from './bot';
import { waitUntil } from '@vercel/functions';
import type { TelegramCloudflareBody } from '$lib/../../blissbase-telegram-entry/src/index';

export const POST: RequestHandler = async ({ request }) => {
    try {
        const data = await request.json() as TelegramCloudflareBody;
        console.log("telegram message from cloudflare", data);

        bot.on(messageFilters, async (ctx) => {
            return await handleMessage(ctx, data)
        })

        waitUntil(bot.handleUpdate(data.telegramPayload))
    } catch (error) {
        console.error(error);
    }

    return new Response('OK', { status: 200 });
};
