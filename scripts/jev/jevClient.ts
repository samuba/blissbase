import { TypeSafeClient, noul, type Questions, type Question, type SystemOneRequest, type SystemOneResult } from "@typesafe-ai/sdk";
import { experimental_evaluate as evaluate } from "ai";
import { JEV_GATEWAY_MODEL, JEV_PINNED_VERSION } from "./constants.ts";

/**
 * TypeSafeClient that answers via Vercel AI Gateway `evaluate`.
 * Native TypeSafeClient → Gateway URL does not work (Gateway has no /v1/systemone).
 */
export function createGatewayTypeSafeClient() {
	return new TypeSafeClient({
		apiKey: gatewayCredentialPlaceholder(),
		defaultModel: JEV_PINNED_VERSION,
		timeout: 30_000,
		fetch: gatewayEvaluateFetch,
	});
}

export function createDirectTypeSafeClient() {
	return new TypeSafeClient({
		defaultModel: JEV_PINNED_VERSION,
		timeout: 30_000,
	});
}

export function hasGatewayAuth() {
	return Boolean(process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim());
}

export function hasDirectTypeSafeAuth() {
	return Boolean(process.env.TYPESAFE_API_KEY?.trim());
}

export async function probeUnaadaptedGatewayTypeSafeClient() {
	const apiKey = process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim();
	if (!apiKey) {
		return { ok: false as const, error: `No AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN` };
	}

	try {
		const client = new TypeSafeClient({
			apiKey,
			baseURL: `https://ai-gateway.vercel.sh`,
			defaultModel: JEV_GATEWAY_MODEL,
			timeout: 15_000,
		});
		await client.systemOne({
			state: `probe`,
			questions: { probe: noul(`Is this a connectivity probe?`) },
		});
		return { ok: true as const };
	} catch (error) {
		return {
			ok: false as const,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export function toEvaluateQuestions(questions: Questions) {
	const mapped: Record<string, EvaluateQuestion> = {};
	for (const [id, question] of Object.entries(questions)) {
		mapped[id] = toEvaluateQuestion(question);
	}
	return mapped;
}

export function fromEvaluateAnswers(answers: Record<string, EvaluateAnswer>) {
	const mapped: Record<string, unknown> = {};
	for (const [id, answer] of Object.entries(answers)) {
		mapped[id] = fromEvaluateAnswer(answer);
	}
	return mapped;
}

async function gatewayEvaluateFetch(input: string, init?: RequestInit) {
	const url = String(input);
	if (!url.includes(`/v1/systemone`)) {
		return jsonResponse({ error: `Gateway adapter only implements POST /v1/systemone` }, 404);
	}

	let body: { state?: unknown; questions?: Questions };
	try {
		body = init?.body ? JSON.parse(String(init.body)) : {};
	} catch {
		return jsonResponse({ error: `Invalid TypeSafe request body` }, 400);
	}

	if (!body.questions || !Object.keys(body.questions).length) {
		return jsonResponse({ error: `questions are required` }, 422);
	}

	try {
		const result = await evaluate({
			model: JEV_GATEWAY_MODEL,
			state: body.state ?? null,
			questions: toEvaluateQuestions(body.questions),
		});
		const resolvedModel = result.response.modelId ?? JEV_GATEWAY_MODEL;
		if (!resolvedModel.includes(JEV_PINNED_VERSION) && resolvedModel !== JEV_GATEWAY_MODEL) {
			console.warn(`[jev] Gateway resolved model ${resolvedModel}; pinned ${JEV_PINNED_VERSION}`);
		}

		return jsonResponse({
			model: resolvedModel,
			answers: fromEvaluateAnswers(result.answers as Record<string, EvaluateAnswer>),
			usage: {
				input_tokens: result.usage.inputTokens ?? 0,
				output_tokens: result.usage.outputTokens ?? 0,
			},
		});
	} catch (error) {
		return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 502);
	}
}

function toEvaluateQuestion(question: Question): EvaluateQuestion {
	if (question.type === `noul`) {
		return {
			type: `boolean`,
			instructions: question.instructions ?? null,
			criteria: question.criteria ?? undefined,
		};
	}
	if (question.type === `choice`) {
		return {
			type: `choice`,
			instructions: question.instructions ?? null,
			criteria: question.criteria,
		};
	}
	return {
		type: `score`,
		instructions: question.instructions ?? null,
		criteria: [...question.criteria],
	};
}

function fromEvaluateAnswer(answer: EvaluateAnswer) {
	if (answer.type === `boolean`) {
		return { type: `noul`, noul: answer.probability };
	}
	if (answer.type === `choice`) {
		const probabilities = answer.probabilities ?? {};
		return {
			type: `choice`,
			choice: answer.choice,
			probabilities,
			confidence: probabilities[answer.choice] ?? 0,
		};
	}
	return {
		type: `score`,
		score: answer.score,
		probabilities: answer.probabilities ?? {},
		confidence: 0,
		legend: {},
	};
}

function gatewayCredentialPlaceholder() {
	return process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim() || `gateway`;
}

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": `application/json` },
	});
}

export type SystemOneFn = <Q extends Questions>(request: SystemOneRequest<Q>) => Promise<SystemOneResult<Q>>;

type EvaluateQuestion =
	| { type: `boolean`; instructions: unknown; criteria?: unknown }
	| { type: `choice`; instructions: unknown; criteria: Record<string, unknown> }
	| { type: `score`; instructions: unknown; criteria: unknown[] };

type EvaluateAnswer =
	| { type: `boolean`; probability: number }
	| { type: `choice`; choice: string; probabilities?: Record<string, number> }
	| { type: `score`; score: number; probabilities?: Record<string, number> };
