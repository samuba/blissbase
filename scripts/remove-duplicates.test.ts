import { describe, expect, it, vi } from 'vitest';
import { findImageHashDuplicatePairs, getFormCreatedDeduplicationPlan, getMergedSourceUrl, preparePreferredSourceEventUpdate, processDuplicates } from './remove-duplicates.ts';

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
                        tagSlugs: [...(eventB.tagSlugs ?? []), ...(eventA.tagSlugs ?? [])],
                    },
                    deletedEventId: eventA.id,
                };
            }

            expect(eventA.id).toBe(2);
            expect(eventB.id).toBe(3);
            expect(eventA.tagSlugs).toEqual([`music`, `dance`]);

            return {
                deletedCount: deletedCount + 1,
                survivingEvent: {
                    ...eventA,
                    tagSlugs: [...(eventA.tagSlugs ?? []), ...(eventB.tagSlugs ?? [])],
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
                { id: 1, tagSlugs: [`dance`] },
                { id: 2, tagSlugs: [`music`] },
                { id: 3, tagSlugs: [`breathwork`] },
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
    it(`preserves catalog tags and chat provenance on the surviving preferred-source event`, () => {
        const eventToSurvive = {
            id: 2,
            tagSlugs: [`yoga`],
            sourceChatIdsTelegram: [`room1`],
            sourceChatIdsWhatsapp: null as string[] | null,
        };
        const eventToDelete = {
            id: 1,
            tagSlugs: [`meditation`, `yoga`],
            sourceChatIdsTelegram: [`room2`],
            sourceChatIdsWhatsapp: [`120363@g.us`],
        };

        const update = preparePreferredSourceEventUpdate({
            eventToSurvive,
            eventToDelete,
        });

        expect(update).toEqual({
            tagSlugs: [`yoga`, `meditation`],
            sourceChatIdsTelegram: [`room1`, `room2`],
            sourceChatIdsWhatsapp: [`120363@g.us`],
        });
        expect(eventToSurvive.tagSlugs).toEqual([`yoga`, `meditation`]);
        expect(eventToSurvive.sourceChatIdsTelegram).toEqual([`room1`, `room2`]);
        expect(eventToSurvive.sourceChatIdsWhatsapp).toEqual([`120363@g.us`]);
    });
});

describe(`getFormCreatedDeduplicationPlan`, () => {
    it(`keeps a form-created event when paired with a duplicate from another source`, () => {
        const formEvent = {
            id: 1,
            source: `website-form`,
        };
        const scrapedEvent = {
            id: 2,
            source: `telegram`,
        };

        const plan = getFormCreatedDeduplicationPlan({
            eventA: scrapedEvent,
            eventB: formEvent,
        });

        expect(plan).toEqual({
            action: `merge`,
            eventToSurvive: formEvent,
            eventToDelete: scrapedEvent,
        });
    });

    it(`skips duplicate removal when both events were created via form`, () => {
        const plan = getFormCreatedDeduplicationPlan({
            eventA: { id: 1, source: `website-form` },
            eventB: { id: 2, source: `website-form` },
        });

        expect(plan).toEqual({ action: `skip` });
    });
});

describe(`getMergedSourceUrl`, () => {
    it(`uses the deleted event source URL when the survivor only has a Blissbase URL`, () => {
        const sourceUrl = getMergedSourceUrl({
            survivingSourceUrl: `https://blissbase.app/ecstatic-dance`,
            deletedSourceUrl: ` https://example.com/ecstatic-dance `,
        });

        expect(sourceUrl).toBe(`https://example.com/ecstatic-dance`);
    });

    it(`keeps the survivor source URL when it is already external`, () => {
        const sourceUrl = getMergedSourceUrl({
            survivingSourceUrl: `https://survivor.test/event`,
            deletedSourceUrl: `https://deleted.test/event`,
        });

        expect(sourceUrl).toBe(`https://survivor.test/event`);
    });
});

describe(`findImageHashDuplicatePairs`, () => {
    it(`skips invalid hashes and still finds a valid duplicate pair`, () => {
        const warnSpy = vi.spyOn(console, `warn`).mockImplementation(() => {});
        const validHashUrl = `https://assets.blissbase.app/events/a/LOZTvW10y7U.webp`;
        const duplicates = findImageHashDuplicatePairs({
            events: [
                { id: 1, imageUrls: [validHashUrl] },
                { id: 2, imageUrls: [`https://assets.blissbase.app/events/b/LOZTvW10y7U.webp`] },
                { id: 3, imageUrls: [`https://assets.blissbase.app/events/c/m5k8x2q-abcdefgh.webp`] },
                { id: 4, imageUrls: [`https://cdn.example.com/image.jpg`] },
            ],
            hammingDistanceThreshold: 5,
        });

        expect(duplicates).toEqual(expect.arrayContaining([
            expect.objectContaining({
                dist: 0,
                eventAId: 1,
                eventBId: 2,
                urlA: validHashUrl,
            }),
            expect.objectContaining({
                dist: 0,
                eventAId: 2,
                eventBId: 1,
            }),
        ]));
        expect(duplicates.some((duplicate) => duplicate.eventAId === 3 || duplicate.eventBId === 3)).toBe(false);
        expect(duplicates.some((duplicate) => duplicate.eventAId === 4 || duplicate.eventBId === 4)).toBe(false);
        expect(warnSpy).toHaveBeenCalledWith(`Skipping invalid image hash for event 3: https://assets.blissbase.app/events/c/m5k8x2q-abcdefgh.webp`);
        expect(warnSpy).toHaveBeenCalledWith(`Skipping invalid image hash for event 4: https://cdn.example.com/image.jpg`);

        warnSpy.mockRestore();
    });
});

type TestEvent = {
    id: number,
    tagSlugs: string[] | null,
};
