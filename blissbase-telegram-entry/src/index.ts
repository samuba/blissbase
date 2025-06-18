import { Telegraf } from "telegraf";
import { anyOf, message } from "telegraf/filters";
import { Update } from "telegraf/types";
import { handleMessage } from "./bot";

export default {
	async fetch(request, env, ctx): Promise<Response> {
		console.log("in worker")
		const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);

		const data = await request.json() as Update
		console.log("http payload", data);

		bot.on(anyOf(message('text'), message('forward_origin')), async (ctx) => {
			await handleMessage(ctx, data)
		})

		ctx.waitUntil(bot.handleUpdate(data))
		return new Response('OK');
	},
} satisfies ExportedHandler<Env>;
