import { allTagSlugs } from "../../src/lib/eventCategories.ts";

export function scorePrediction({ gold, predicted }: { gold: string[]; predicted: string[] }) {
	const goldSet = new Set(gold);
	const predictedSet = new Set(predicted);
	let hits = 0;
	for (const slug of predicted) {
		if (goldSet.has(slug)) hits += 1;
	}

	const precision = predicted.length ? hits / predicted.length : 0;
	const recall = gold.length ? hits / gold.length : 0;
	const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

	const union = new Set([...gold, ...predicted]);
	const jaccard = union.size ? hits / union.size : 1;
	const invented = predicted.filter((slug) => !allTagSlugs.has(slug));

	return {
		hits,
		precision,
		recall,
		f1,
		jaccard,
		invented,
		overlapAccept: jaccard >= 0.5 || (hits >= 1 && precision >= 0.5),
	};
}

export function summarizeScores(
	rows: Array<ReturnType<typeof scorePrediction> & { language?: string; latencyMs?: number; inputTokens?: number }>,
) {
	const summary = {
		count: rows.length,
		precision: mean(rows.map((row) => row.precision)),
		recall: mean(rows.map((row) => row.recall)),
		f1: mean(rows.map((row) => row.f1)),
		jaccard: mean(rows.map((row) => row.jaccard)),
		overlapAcceptRate: mean(rows.map((row) => (row.overlapAccept ? 1 : 0))),
		inventedCount: rows.reduce((sum, row) => sum + row.invented.length, 0),
		latencyMs: mean(rows.map((row) => row.latencyMs ?? 0)),
		inputTokens: rows.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0),
		byLanguage: {} as Record<string, { count: number; precision: number; recall: number; f1: number; overlapAcceptRate: number }>,
	};

	const grouped = new Map<string, typeof rows>();
	for (const row of rows) {
		const language = row.language ?? `unknown`;
		const group = grouped.get(language);
		if (group) {
			group.push(row);
			continue;
		}
		grouped.set(language, [row]);
	}

	for (const [language, group] of grouped) {
		summary.byLanguage[language] = {
			count: group.length,
			precision: mean(group.map((row) => row.precision)),
			recall: mean(group.map((row) => row.recall)),
			f1: mean(group.map((row) => row.f1)),
			overlapAcceptRate: mean(group.map((row) => (row.overlapAccept ? 1 : 0))),
		};
	}

	return summary;
}

function mean(values: number[]) {
	if (!values.length) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}
