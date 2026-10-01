import { describe, expect, it } from "vitest";
import { expectLines, withoutSymbols } from "./transcriptLines";

describe(`expectLines`, () => {
	it(`treats punctuation and symbols as the same separator`, () => {
		expect(withoutSymbols(`MANTRAS · MUSIK`)).toBe(withoutSymbols(`MANTRAS • MUSIK`));
		expect(withoutSymbols(`18:45 – 21:30`)).toBe(withoutSymbols(`18:45 - 21:30`));
		expect(withoutSymbols(`„HEILSAM“`)).toBe(`HEILSAM`);
		expectLines(`MANTRAS · MUSIK • VERBINDUNG`, [`MANTRAS • MUSIK · VERBINDUNG`]);
	});

	it(`still requires umlauts and capitalization`, () => {
		expect(withoutSymbols(`Münchhausen`)).not.toBe(withoutSymbols(`Muenchhausen`));
		expect(withoutSymbols(`REINIGUNGSHÜTTE`)).not.toBe(withoutSymbols(`Reinigungshütte`));
	});

	it(`reports the missing line and the nearest change without the rest of the transcript`, () => {
		const message = failureMessage(() =>
			expectLines(`Erhalte Einsichten für ein neuen Weg zu leben.\nUnrelated footer text stays out of the message`, [
				`Erhalte Einsichten für einen neuen Weg zu leben.`,
			]),
		);

		expect(message).toContain(`not in transcript: Erhalte Einsichten für einen neuen Weg zu leben.`);
		expect(message).toContain(`nearest: Erhalte Einsichten für ein neuen Weg zu leben`);
		expect(message).toContain(`changed: einen -> ein`);
		expect(message).not.toContain(`Unrelated footer`);
	});

	it(`reports a line that has no similar text`, () => {
		const message = failureMessage(() => expectLines(`Completely different poster`, [`DER RAHMEN`]));

		expect(message).toContain(`not in transcript: DER RAHMEN`);
		expect(message).not.toContain(`nearest`);
		expect(message).not.toContain(`Completely different`);
	});
});

function failureMessage(run: () => void) {
	try {
		run();
	} catch (error) {
		if (error instanceof Error) return error.message;
	}
	return ``;
}
