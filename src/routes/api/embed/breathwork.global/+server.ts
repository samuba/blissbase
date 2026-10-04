import { json, type RequestHandler } from "@sveltejs/kit";
import { breathworkEmbedQueryFromBody, searchBreathworkEmbedEvents } from "./breathworkEmbed";

const ALLOWED_HOSTS = new Set([`breathwork.global`, `www.breathwork.global`]);

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, { status: 204, headers: corsHeaders(request) });
};

export const POST: RequestHandler = async ({ request }) => {
	const headers = corsHeaders(request);
	try {
		const body = await request.json();
		const result = await searchBreathworkEmbedEvents(breathworkEmbedQueryFromBody(body));
		return json(result, { headers });
	} catch (error) {
		console.error(`breathwork embed request failed`, error);
		return json({ results: [], nextCursor: null }, { headers });
	}
};

function corsHeaders(request: Request) {
	const headers: Record<string, string> = {
		"Access-Control-Allow-Methods": `POST, OPTIONS`,
		"Access-Control-Allow-Headers": `Content-Type`,
		Vary: `Origin`,
	};
	const origin = request.headers.get(`origin`);
	if (!origin || !isBreathworkGlobalOrigin(origin)) return headers;
	headers["Access-Control-Allow-Origin"] = origin;
	return headers;
}

function isBreathworkGlobalOrigin(origin: string) {
	try {
		const url = new URL(origin);
		return url.protocol === `https:` && ALLOWED_HOSTS.has(url.hostname);
	} catch {
		return false;
	}
}
