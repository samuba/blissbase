import { describe, expect, it, vi } from 'vitest';
import { preparePreferredSourceEventUpdate, processDuplicates } from './remove-duplicates.ts';

describe(`processDuplicates`, () => {
    it(`skips stale duplicate pairs and keeps the latest survivor state`, async () => {
        const warnSpy = vi.spyOn(console, `warn`).mockImplementation(() => {});
        const mergeDuplicateEvents = vi.fn(async ({ eventA, eventB, deletedCount }: {
            eventA: TestEvent,
            eventB: TestEvent,
            deletedCount: number,
        }) => {
            if (eventA.id === 1 && eventB.id === 2) {
                return {
                    deletedCount: deletedCount + 1,
                    survivingEvent: {
                        ...eventB,
                        tags: [...(eventB.tags ?? []), ...(eventA.tags ?? [])],
                    },
                    deletedEventId: eventA.id,
                };
            }

            expect(eventA.id).toBe(2);
            expect(eventB.id).toBe(3);
            expect(eventA.tags).toEqual([`music`, `dance`]);

            return {
                deletedCount: deletedCount + 1,
                survivingEvent: {
                    ...eventA,
                    tags: [...(eventA.tags ?? []), ...(eventB.tags ?? [])],
                },
                deletedEventId: eventB.id,
            };
        });

        const deletedCount = await processDuplicates({
            duplicates: [
                { eventAId: 1, eventBId: 2 },
                { eventAId: 1, eventBId: 3 },
                { eventAId: 2, eventBId: 3 },
            ],
            eventsWithSameStart: [
                { id: 1, tags: [`dance`] },
                { id: 2, tags: [`music`] },
                { id: 3, tags: [`breathwork`] },
            ],
            mergeDuplicateEvents,
        });

        expect(deletedCount).toBe(2);
        expect(mergeDuplicateEvents).toHaveBeenCalledTimes(2);
        expect(mergeDuplicateEvents.mock.calls[0]?.[0].eventA.id).toBe(1);
        expect(mergeDuplicateEvents.mock.calls[0]?.[0].eventB.id).toBe(2);
        expect(mergeDuplicateEvents.mock.calls[1]?.[0].eventA.id).toBe(2);
        expect(mergeDuplicateEvents.mock.calls[1]?.[0].eventB.id).toBe(3);
        expect(warnSpy).toHaveBeenCalledWith(`Event not found for id: 1 or 3`);

        warnSpy.mockRestore();
    });
});

describe(`preparePreferredSourceEventUpdate`, () => {
    it(`preserves legacy tags on the surviving preferred-source event`, () => {
        const eventToSurvive = {
            id: 2,
            tags: [`music`],
        };
        const eventToDelete = {
            id: 1,
            tags: [`workshop`, `music`],
        };

        const update = preparePreferredSourceEventUpdate({
            eventToSurvive,
            eventToDelete,
        });

        expect(update).toEqual({
            tags: [`music`, `workshop`],
        });
        expect(eventToSurvive.tags).toEqual([`music`, `workshop`]);
    });
});

type TestEvent = {
    id: number,
    tags: string[] | null,
};
