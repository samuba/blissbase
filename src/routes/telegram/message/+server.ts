import type { RequestHandler } from '@sveltejs/kit';
import { handleMessage, messageFilters } from './bot';
import { waitUntil } from '@vercel/functions';
import type { TelegramCloudflareBody } from '$lib/../../blissbase-telegram-entry/src/index';
import { TELEGRAM_BOT_TOKEN } from '$env/static/private';
import { Telegraf } from 'telegraf';

export const POST: RequestHandler = async ({ request }) => {
    try {
        const data = await request.json() as TelegramCloudflareBody;
        console.log("telegram message from cloudflare", data);

        const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
        bot.on(messageFilters, async (ctx) => {
            return await handleMessage(ctx, data)
        })
        await bot.handleUpdate(data.telegramPayload)
    } catch (error) {
        console.error(error);
    }

    return new Response('OK', { status: 200 });
};
