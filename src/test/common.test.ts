import { formatDatesStr, formatTimesStr, generateSlug } from '../lib/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Fixed "now": Wed 4 Jun 2025, 12:00 local — used by relative-date logic. */
const REFERENCE_NOW = new Date(2025, 5, 4, 12, 0, 0);

describe('formatTimesStr', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(REFERENCE_NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns Date TBD when start is undefined', () => {
        expect(formatTimesStr(undefined, undefined, 'de')).toBe('TBD');
        expect(formatTimesStr(undefined, undefined, 'en')).toBe('TBD');
    });

    it('formats a single start time', () => {
        const start = new Date(2025, 5, 4, 18, 0);
        expect(formatTimesStr(start, null, 'de')).toBe('18:00');
        expect(formatTimesStr(start, null, 'en')).toBe('6:00 PM');

        const noon = new Date(2025, 5, 4, 12, 0);
        expect(formatTimesStr(noon, null, 'de')).toBe('12:00');
        expect(formatTimesStr(noon, null, 'en')).toBe('12:00 PM');
    });

    it('formats a time range on the same day or next day before noon', () => {
        const start = new Date(2025, 5, 4, 18, 0);
        const sameDayEnd = new Date(2025, 5, 4, 22, 0);
        expect(formatTimesStr(start, sameDayEnd, 'de')).toBe('18:00 – 22:00');
        expect(formatTimesStr(start, sameDayEnd, 'en')).toBe('6:00 PM – 10:00 PM');

        const nextMorningEnd = new Date(2025, 5, 5, 10, 0);
        expect(formatTimesStr(start, nextMorningEnd, 'de')).toBe('18:00 – 10:00');
        expect(formatTimesStr(start, nextMorningEnd, 'en')).toBe('6:00 PM – 10:00 AM');
    });

    it('returns empty string for multi-day spans', () => {
        const start = new Date(2025, 5, 4, 18, 0);
        expect(formatTimesStr(start, new Date(2025, 5, 5, 12, 0), 'de')).toBe('');
        expect(formatTimesStr(start, new Date(2025, 5, 5, 12, 0), 'en')).toBe('');

        const futureStart = new Date(2025, 5, 10, 18, 0);
        expect(formatTimesStr(futureStart, new Date(2025, 5, 12, 18, 0), 'de')).toBe('');
        expect(formatTimesStr(futureStart, new Date(2025, 5, 12, 18, 0), 'en')).toBe('');
    });

    it('omits midnight placeholder times', () => {
        const midnight = new Date(2025, 5, 4, 0, 0);
        expect(formatTimesStr(midnight, null, 'de')).toBe('');
        expect(formatTimesStr(midnight, midnight, 'de')).toBe('');

        expect(formatTimesStr(midnight, null, 'en')).toBe('');
        expect(formatTimesStr(midnight, midnight, 'en')).toBe('');
    });
});

describe('formatDatesStr', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(REFERENCE_NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns Date TBD when start is undefined', () => {
        expect(formatDatesStr(undefined, undefined, 'de')).toBe('Date TBD');
        expect(formatDatesStr(undefined, undefined, 'en')).toBe('Date TBD');
    });

    it('formats relative single days without a range', () => {
        const today = new Date(2025, 5, 4, 18, 0);
        const todayEnd = new Date(2025, 5, 4, 22, 0);
        const tomorrow = new Date(2025, 5, 5, 18, 0);
        const yesterday = new Date(2025, 5, 3, 18, 0);

        expect(formatDatesStr(today, todayEnd, 'de')).toBe('Heute');
        expect(formatDatesStr(today, null, 'de')).toBe('Heute');
        expect(formatDatesStr(tomorrow, null, 'de')).toBe('Morgen');
        expect(formatDatesStr(yesterday, null, 'de')).toBe('Gestern');

        expect(formatDatesStr(today, todayEnd, 'en')).toBe('Today');
        expect(formatDatesStr(today, null, 'en')).toBe('Today');
        expect(formatDatesStr(tomorrow, null, 'en')).toBe('Tomorrow');
        expect(formatDatesStr(yesterday, null, 'en')).toBe('Yesterday');
    });

    it('keeps a single date when the end is the next calendar day before noon', () => {
        const start = new Date(2025, 5, 4, 18, 0);
        const end = new Date(2025, 5, 5, 10, 0);
        expect(formatDatesStr(start, end, 'de')).toBe('Heute');
        expect(formatDatesStr(start, end, 'en')).toBe('Today');
    });

    it('prefixes weekday for dates that are not today, tomorrow, or yesterday', () => {
        const start = new Date(2025, 5, 10, 18, 0);
        const end = new Date(2025, 5, 10, 22, 0);

        expect(formatDatesStr(start, end, 'de')).toBe('Di. 10. Juni 2025');
        expect(formatDatesStr(start, null, 'de')).toBe('Di. 10. Juni 2025');

        expect(formatDatesStr(start, end, 'en')).toBe('Tue. Jun 10, 2025');
        expect(formatDatesStr(start, null, 'en')).toBe('Tue. Jun 10, 2025');
    });

    it('formats multi-day spans as a date range', () => {
        const start = new Date(2025, 5, 4, 18, 0);
        const end = new Date(2025, 5, 5, 12, 0);
        expect(formatDatesStr(start, end, 'de')).toBe('Heute – 5. Juni 2025');
        expect(formatDatesStr(start, end, 'en')).toBe('Today – Jun 5, 2025');

        const longStart = new Date(2025, 5, 4, 18, 0);
        const longEnd = new Date(2025, 5, 6, 18, 0);
        expect(formatDatesStr(longStart, longEnd, 'de')).toBe('Heute – 6. Juni 2025');
        expect(formatDatesStr(longStart, longEnd, 'en')).toBe('Today – Jun 6, 2025');

        const futureStart = new Date(2025, 5, 10, 18, 0);
        const futureEnd = new Date(2025, 5, 12, 18, 0);
        expect(formatDatesStr(futureStart, futureEnd, 'de')).toBe('Di. 10.–12. Juni 2025');
        expect(formatDatesStr(futureStart, futureEnd, 'en')).toBe('Tue. Jun 10 – 12, 2025');
    });

    it('omits repeated year in date ranges within the same year', () => {
        const start = new Date(2025, 5, 10, 18, 0);
        const end = new Date(2025, 6, 12, 18, 0);

        expect(formatDatesStr(start, end, 'de')).toBe('Di. 10. Juni – 12. Juli 2025');
        expect(formatDatesStr(start, end, 'en')).toBe('Tue. Jun 10 – Jul 12, 2025');
    });

    it('keeps both years in date ranges across different years', () => {
        const start = new Date(2025, 11, 31, 18, 0);
        const end = new Date(2026, 0, 2, 18, 0);

        expect(formatDatesStr(start, end, 'de')).toBe('Mi. 31. Dez. 2025 – 2. Jan. 2026');
        expect(formatDatesStr(start, end, 'en')).toBe('Wed. Dec 31, 2025 – Jan 2, 2026');
    });

    it('excludes the year for current-year single dates when requested', () => {
        const start = new Date(2025, 5, 10, 18, 0);

        expect(formatDatesStr(start, null, 'de', true)).toBe('Di. 10. Juni');
        expect(formatDatesStr(start, null, 'en', true)).toBe('Tue. Jun 10');
    });

    it('excludes the year for current-year date ranges when requested', () => {
        const sameMonthStart = new Date(2025, 5, 10, 18, 0);
        const sameMonthEnd = new Date(2025, 5, 12, 18, 0);
        expect(formatDatesStr(sameMonthStart, sameMonthEnd, 'de', true)).toBe('Di. 10.–12. Juni');
        expect(formatDatesStr(sameMonthStart, sameMonthEnd, 'en', true)).toBe('Tue. Jun 10 – 12');

        const sameYearEnd = new Date(2025, 6, 12, 18, 0);
        expect(formatDatesStr(sameMonthStart, sameYearEnd, 'de', true)).toBe('Di. 10. Juni – 12. Juli');
        expect(formatDatesStr(sameMonthStart, sameYearEnd, 'en', true)).toBe('Tue. Jun 10 – Jul 12');
    });

    it('keeps the year for non-current-year dates when exclusion is requested', () => {
        const start = new Date(2026, 5, 10, 18, 0);
        const end = new Date(2026, 5, 12, 18, 0);

        expect(formatDatesStr(start, null, 'de', true)).toBe('Mi. 10. Juni 2026');
        expect(formatDatesStr(start, null, 'en', true)).toBe('Wed. Jun 10, 2026');
        expect(formatDatesStr(start, end, 'de', true)).toBe('Mi. 10.–12. Juni 2026');
        expect(formatDatesStr(start, end, 'en', true)).toBe('Wed. Jun 10 – 12, 2026');
    });

    it('excludes the year from relative range ends in the current year when requested', () => {
        const start = new Date(2025, 5, 4, 18, 0);
        const end = new Date(2025, 5, 6, 18, 0);

        expect(formatDatesStr(start, end, 'de', true)).toBe('Heute – 6. Juni');
        expect(formatDatesStr(start, end, 'en', true)).toBe('Today – Jun 6');
    });
});

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
