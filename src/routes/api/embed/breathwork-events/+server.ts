import { json, type RequestHandler } from "@sveltejs/kit";
import { breathworkEmbedQueryFromBody, searchBreathworkEmbedEvents } from "$lib/server/breathworkEmbed";

const corsHeaders = {
	"Access-Control-Allow-Origin": `*`,
	"Access-Control-Allow-Methods": `POST, OPTIONS`,
	"Access-Control-Allow-Headers": `Content-Type`,
};

export const OPTIONS: RequestHandler = () => {
	return new Response(null, { status: 204, headers: corsHeaders });
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const result = await searchBreathworkEmbedEvents(breathworkEmbedQueryFromBody(body));
		return json(result, { headers: corsHeaders });
	} catch (error) {
		console.error(`breathwork embed request failed`, error);
		return json({ results: [], nextCursor: null }, { headers: corsHeaders });
	}
};
