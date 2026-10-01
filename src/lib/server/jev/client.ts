import { TypeSafeClient } from "@typesafe-ai/sdk";

export function jevClient() {
	return new TypeSafeClient({
		timeout: 10_000,
		apiKey: process.env.AI_GATEWAY_API_KEY,
		baseURL: `https://ai-gateway.vercel.sh/typesafe`,
	});
}
