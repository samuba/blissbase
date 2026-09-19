/**
 * Offline Jev vs stored-slug tagger bake-off. Does not write to the database.
 *
 *   bun run jev:export-gold
 *   bun run jev:bakeoff
 *   bun run jev:bakeoff -- --gold scripts/jev/gold-set.json --limit 20
 *   bun run jev:bakeoff -- --compare-luna
 *   bun run jev:bakeoff -- --direct
 *   bun run jev:bakeoff -- --probe
 *
 * Auth: AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN (Gateway). TYPESAFE_API_KEY only for --direct.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	createDirectTypeSafeClient,
	createGatewayTypeSafeClient,
	hasDirectTypeSafeAuth,
	hasGatewayAuth,
	probeUnaadaptedGatewayTypeSafeClient,
	type SystemOneFn,
} from "./jevClient.ts";
import { suggestTagSlugsWithJev } from "./suggestTagSlugsWithJev.ts";
import { scorePrediction, summarizeScores } from "./bakeoffScore.ts";
import type { GoldEvent } from "./goldSet.ts";
import { JEV_GATEWAY_MODEL, JEV_PINNED_VERSION } from "./constants.ts";

const args = parseArgs(process.argv.slice(2));

if (args.probe) {
	const probe = await probeUnaadaptedGatewayTypeSafeClient();
	console.log(`Unaadapted TypeSafeClient → https://ai-gateway.vercel.sh /v1/systemone:`, probe);
	process.exit(probe.ok ? 0 : 2);
}

const goldPath = resolve(args.gold);
let gold: GoldEvent[];
try {
	gold = JSON.parse(readFileSync(goldPath, `utf8`));
} catch {
	console.error(`Gold set not found at ${goldPath}. Export first: bun run jev:export-gold`);
	process.exit(1);
}

if (!gold?.length) {
	console.error(`Gold set is empty: ${goldPath}`);
	process.exit(1);
}

const events = gold.slice(0, args.limit ?? gold.length);
const systemOne = createSystemOne(args.direct);
const compareLuna = args.compareLuna ? (await import(`../../src/lib/server/ai.ts`)).aiSuggestTagSlugs : null;

console.log(`Bake-off: ${events.length} events via ${args.direct ? `TypeSafe ${JEV_PINNED_VERSION}` : `Gateway ${JEV_GATEWAY_MODEL}`}`);

const rows = [];
for (let i = 0; i < events.length; i += args.concurrency) {
	const batch = events.slice(i, i + args.concurrency);
	const batchRows = await Promise.all(
		batch.map(async (event) => {
			try {
				const jev = await suggestTagSlugsWithJev({
					name: event.name,
					description: event.description,
					systemOne,
				});
				const jevScore = scorePrediction({ gold: event.tagSlugs, predicted: jev.slugs });
				let luna: { slugs: string[]; score: ReturnType<typeof scorePrediction>; latencyMs: number } | undefined;
				if (compareLuna) {
					const lunaStarted = performance.now();
					const slugs = await compareLuna({ name: event.name, description: event.description });
					luna = {
						slugs,
						score: scorePrediction({ gold: event.tagSlugs, predicted: slugs }),
						latencyMs: performance.now() - lunaStarted,
					};
				}
				return {
					id: event.id,
					name: event.name,
					language: event.language,
					gold: event.tagSlugs,
					jev: {
						slugs: jev.slugs,
						category: jev.category,
						categoryConfidence: jev.categoryConfidence,
						beamedCategories: jev.beamedCategories,
						model: jev.model,
						...jevScore,
						latencyMs: jev.latencyMs,
						inputTokens: jev.usage.input_tokens,
					},
					luna,
				};
			} catch (error) {
				console.error(`Failed on "${event.name}" (${event.id}):`, error);
				return {
					id: event.id,
					name: event.name,
					language: event.language,
					gold: event.tagSlugs,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		}),
	);
	rows.push(...batchRows);
	console.log(`… ${Math.min(i + args.concurrency, events.length)}/${events.length}`);
}

const scored = rows.filter((row): row is Extract<(typeof rows)[number], { jev: object }> => `jev` in row && row.jev != null);
const summary = {
	transport: args.direct ? `typesafe-direct` : `ai-gateway`,
	pinnedVersion: JEV_PINNED_VERSION,
	gatewayModel: JEV_GATEWAY_MODEL,
	goldPath,
	jev: summarizeScores(
		scored.map((row) => ({
			...row.jev,
			language: row.language,
			latencyMs: row.jev.latencyMs,
			inputTokens: row.jev.inputTokens,
		})),
	),
	luna: compareLuna
		? summarizeScores(
				scored
					.filter((row) => row.luna)
					.map((row) => ({
						...row.luna!.score,
						language: row.language,
						latencyMs: row.luna!.latencyMs,
					})),
			)
		: undefined,
	failed: rows.length - scored.length,
};

const outPath = resolve(args.out);
writeFileSync(outPath, `${JSON.stringify({ summary, rows }, null, `\t`)}\n`);
console.log(JSON.stringify(summary, null, 2));
console.log(`Wrote ${outPath}`);

if (summary.jev.byLanguage.de && summary.jev.byLanguage.de.f1 < 0.35) {
	console.warn(`German F1 is weak (${summary.jev.byLanguage.de.f1.toFixed(3)}). Stop — do not paper over it with a bigger state.`);
}

function createSystemOne(direct: boolean): SystemOneFn {
	if (direct) {
		if (!hasDirectTypeSafeAuth()) {
			console.error(`--direct needs TYPESAFE_API_KEY`);
			process.exit(1);
		}
		const client = createDirectTypeSafeClient();
		return (request) => client.systemOne(request);
	}
	if (!hasGatewayAuth()) {
		console.error(`Gateway bake-off needs AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN (from vercel env pull).`);
		process.exit(1);
	}
	const client = createGatewayTypeSafeClient();
	return (request) => client.systemOne(request);
}

function parseArgs(argv: string[]) {
	const get = (flag: string) => {
		const index = argv.indexOf(flag);
		if (index < 0) return undefined;
		return argv[index + 1];
	};
	return {
		gold: get(`--gold`) ?? `scripts/jev/gold-set.json`,
		out: get(`--out`) ?? `scripts/jev/bakeoff-results.json`,
		limit: get(`--limit`) ? Number(get(`--limit`)) : undefined,
		concurrency: get(`--concurrency`) ? Number(get(`--concurrency`)) : 5,
		compareLuna: argv.includes(`--compare-luna`),
		direct: argv.includes(`--direct`),
		probe: argv.includes(`--probe`),
	};
}
