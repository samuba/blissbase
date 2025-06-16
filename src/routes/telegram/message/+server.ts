import type { RequestHandler } from '@sveltejs/kit';
import { bot } from './bot';

export const POST: RequestHandler = async ({ request }) => {
    try {
        const data = await request.json();
        console.log("http payload", data);
        bot.handleUpdate(data)
    } catch (error) {
        console.error(error);
    }

    return new Response('OK', { status: 200 });
};
