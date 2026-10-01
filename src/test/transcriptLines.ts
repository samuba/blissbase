import { expect } from "vitest";

/** Fails with each expected line missing from the transcript, plus the nearest transcript text and the changed words. */
export function expectLines(transcript: string, expectedLines: readonly string[]) {
	const comparableTranscript = withoutSymbols(transcript);
	const missing = expectedLines.filter((line) => {
		const needle = withoutSymbols(line);
		return needle.length > 0 && !comparableTranscript.includes(needle);
	});
	if (!missing.length) return;

	expect.fail(missing.map((line) => describeMissingLine(line, transcript)).join(`\n`));
}

// Letters and numbers have to match. Punctuation and symbols such as · and • do not.
export function withoutSymbols(text: string) {
	return text.replace(/[^\p{L}\p{N}]+/gu, ` `).replace(/ +/g, ` `).trim();
}

function describeMissingLine(line: string, transcript: string) {
	const nearest = nearestTranscriptText(line, transcript);
	if (!nearest) return `not in transcript: ${line}`;

	const changed = wordChanges(words(line), words(nearest));
	return `not in transcript: ${line}\nnearest: ${nearest}\nchanged: ${changed}`;
}

function nearestTranscriptText(line: string, transcript: string) {
	const expectedWords = words(line);
	const transcriptWords = words(transcript);
	if (!expectedWords.length || !transcriptWords.length) return undefined;

	let best = ``;
	let bestScore = 0;
	const minWindow = Math.max(1, expectedWords.length - 2);
	const maxWindow = expectedWords.length + 2;
	for (let size = minWindow; size <= maxWindow; size++) {
		for (let start = 0; start + size <= transcriptWords.length; start++) {
			const window = transcriptWords.slice(start, start + size).join(` `);
			const score = textSimilarity(expectedWords.join(` `), window);
			if (score <= bestScore) continue;
			bestScore = score;
			best = window;
		}
	}

	if (bestScore < 0.5) return undefined;
	return best;
}

function wordChanges(expectedWords: string[], nearestWords: string[]) {
	const shared = longestCommonWordSubsequence(expectedWords, nearestWords);
	const changes: string[] = [];
	let expectedIndex = 0;
	let nearestIndex = 0;
	for (const word of shared) {
		const removed: string[] = [];
		const added: string[] = [];
		while (expectedIndex < expectedWords.length && expectedWords[expectedIndex] !== word) {
			removed.push(expectedWords[expectedIndex] ?? ``);
			expectedIndex++;
		}
		while (nearestIndex < nearestWords.length && nearestWords[nearestIndex] !== word) {
			added.push(nearestWords[nearestIndex] ?? ``);
			nearestIndex++;
		}
		pushWordChange(changes, removed, added);
		expectedIndex++;
		nearestIndex++;
	}
	pushWordChange(changes, expectedWords.slice(expectedIndex), nearestWords.slice(nearestIndex));
	return changes.join(`, `);
}

function pushWordChange(changes: string[], removed: string[], added: string[]) {
	if (removed.length && added.length) {
		changes.push(`${removed.join(` `)} -> ${added.join(` `)}`);
		return;
	}
	if (removed.length) changes.push(`- ${removed.join(` `)}`);
	if (added.length) changes.push(`+ ${added.join(` `)}`);
}

function longestCommonWordSubsequence(left: string[], right: string[]) {
	const lengths = Array.from({ length: left.length + 1 }, () => Array.from({ length: right.length + 1 }, () => 0));
	for (let i = 1; i <= left.length; i++) {
		for (let j = 1; j <= right.length; j++) {
			const row = lengths[i];
			const previousRow = lengths[i - 1];
			if (!row || !previousRow) continue;
			row[j] = left[i - 1] === right[j - 1] ? (previousRow[j - 1] ?? 0) + 1 : Math.max(previousRow[j] ?? 0, row[j - 1] ?? 0);
		}
	}

	const sequence: string[] = [];
	let i = left.length;
	let j = right.length;
	while (i > 0 && j > 0) {
		if (left[i - 1] === right[j - 1]) {
			sequence.push(left[i - 1] ?? ``);
			i--;
			j--;
			continue;
		}
		const fromAbove = lengths[i - 1]?.[j] ?? 0;
		const fromLeft = lengths[i]?.[j - 1] ?? 0;
		if (fromAbove >= fromLeft) i--;
		else j--;
	}
	sequence.reverse();
	return sequence;
}

function textSimilarity(left: string, right: string) {
	const longest = Math.max(left.length, right.length);
	if (!longest) return 1;
	return 1 - levenshtein(left, right) / longest;
}

function levenshtein(left: string, right: string) {
	const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (let i = 1; i <= left.length; i++) {
		let diagonal = previous[0] ?? 0;
		previous[0] = i;
		for (let j = 1; j <= right.length; j++) {
			const above = previous[j] ?? 0;
			const beside = previous[j - 1] ?? 0;
			const next = left[i - 1] === right[j - 1] ? diagonal : Math.min(diagonal, above, beside) + 1;
			diagonal = above;
			previous[j] = next;
		}
	}
	return previous[right.length] ?? 0;
}

function words(text: string) {
	return withoutSymbols(text).split(` `).filter((word) => word.length);
}
