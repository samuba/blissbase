import { generateSlug } from '../lib/common';
import { describe, it, expect } from 'vitest';

describe('generateSlug', () => {
    const startAt = new Date('2025-07-04T18:00:00+0200');
    const endAt = new Date('2025-07-04T20:00:00+0200');

    it('handles special characters', () => {
        expect(
            generateSlug({
                name: "Tantra für Paare & Singles, Einsteiger & Fortgeschrittene, Frauen & Männer TEST!",
                startAt, endAt
            }))
            .toBe('2025-07-04-tantra-fuer-paare-singles-einsteiger-fortgeschrittene-frauen-maenner-test');

        expect(
            generateSlug({
                name: `5Rhythms®-Wave “move & groove”`,
                startAt, endAt
            }))
            .toBe('2025-07-04-5rhythmswave-move-groove');
    });
}); 
