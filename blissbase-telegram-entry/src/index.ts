import { Telegraf } from "telegraf";
import { anyOf, message } from "telegraf/filters";
import { Update } from "telegraf/types";
import { handleMessage } from "./bot";

export default {
	async fetch(request, env, ctx): Promise<Response> {
		console.log("in worker")
		const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);

		const msg = await request.json() as { telegramPayload: Update, aiAnswer: MsgAnalysisAnswer }
		console.log("http payload", msg);

		bot.on(anyOf(message('text'), message('forward_origin')), async (ctx) => {
			await handleMessage(ctx, { aiAnswer: msg.aiAnswer })
		})

		ctx.waitUntil(bot.handleUpdate(msg.telegramPayload))
		return new Response('OK');
	},
} satisfies ExportedHandler<Env>;
