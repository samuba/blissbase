import type { RequestHandler } from '@sveltejs/kit';
import { bot } from './bot';
import { waitUntil } from '@vercel/functions';

export const POST: RequestHandler = async ({ request }) => {
    console.log("post request");
    try {
        const data = await request.json();
        console.log("http payload", data);

        waitUntil(bot.handleUpdate(data))
    } catch (error) {
        console.error(error);
    }

    return new Response('OK', { status: 200 });
};
