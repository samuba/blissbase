import { describe, expect, it, vi } from 'vitest';

vi.mock("../src/lib/imageProcessing", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/lib/imageProcessing")>();
    return {
        ...actual,
        calculateHammingDistance: vi.fn((hash1: string, hash2: string) => {
            if (hash1 === `cover-image` || hash2 === `cover-image`) {
                throw new Error(`Failed to decode base64 string: Invalid character (cover-image)`);
            }
            return actual.calculateHammingDistance(hash1, hash2);
        }),
    };
});

import { findImageHashDuplicatePairs, getFormCreatedDeduplicationPlan, getMergedSourceUrl, preparePreferredSourceEventUpdate, processDuplicates, runDeduplicateSafely } from './remove-duplicates.ts';

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

    it(`logs a pair failure and keeps processing later pairs`, async () => {
        const errorSpy = vi.spyOn(console, `error`).mockImplementation(() => {});
        const mergeDuplicateEvents = vi.fn(async ({ eventA, eventB, deletedCount }: {
            eventA: TestEvent,
            eventB: TestEvent,
            deletedCount: number,
        }) => {
            if (eventA.id === 1) throw new Error(`merge blew up`);
            return {
                deletedCount: deletedCount + 1,
                survivingEvent: eventA,
                deletedEventId: eventB.id,
            };
        });

        const deletedCount = await processDuplicates({
            duplicates: [
                { eventAId: 1, eventBId: 2 },
                { eventAId: 3, eventBId: 4 },
            ],
            eventsWithSameStart: [
                { id: 1, slug: `event-a` },
                { id: 2, slug: `event-b` },
                { id: 3, slug: `event-c` },
                { id: 4, slug: `event-d` },
            ],
            mergeDuplicateEvents,
        });

        expect(deletedCount).toBe(1);
        expect(mergeDuplicateEvents).toHaveBeenCalledTimes(2);
        expect(errorSpy).toHaveBeenCalledWith(
            `Failed to process duplicate pair for event 1 (event-a) https://blissbase.app/event-a vs event 2 (event-b) https://blissbase.app/event-b`,
            expect.any(Error),
        );

        errorSpy.mockRestore();
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
        const errorSpy = vi.spyOn(console, `error`).mockImplementation(() => {});
        const validHashUrl = `https://assets.blissbase.app/events/a/LOZTvW10y7U.webp`;
        const invalidUrl = `https://assets.blissbase.app/events/c/m5k8x2q-abcdefgh.webp`;
        const originalUrl = `https://cdn.example.com/image.jpg`;
        const duplicates = findImageHashDuplicatePairs({
            events: [
                { id: 1, slug: `event-a`, imageUrls: [validHashUrl] },
                { id: 2, slug: `event-b`, imageUrls: [`https://assets.blissbase.app/events/b/LOZTvW10y7U.webp`] },
                { id: 3, slug: `event-c`, imageUrls: [invalidUrl] },
                { id: 4, imageUrls: [originalUrl] },
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
        expect(errorSpy).toHaveBeenCalledWith(`Invalid image hash for event 3 (event-c) https://blissbase.app/event-c image ${invalidUrl}`);
        expect(errorSpy).toHaveBeenCalledWith(`Invalid image hash for event 4 image ${originalUrl}`);

        errorSpy.mockRestore();
    });

    it(`logs the decode error with event and image URL and keeps other pairs`, () => {
        const errorSpy = vi.spyOn(console, `error`).mockImplementation(() => {});
        const validHashUrl = `https://assets.blissbase.app/events/a/LOZTvW10y7U.webp`;
        const failedImageUrl = `https://assets.blissbase.app/events/c/cover-image.webp`;
        const duplicates = findImageHashDuplicatePairs({
            events: [
                { id: 1, slug: `event-a`, imageUrls: [validHashUrl] },
                { id: 2, slug: `event-b`, imageUrls: [`https://assets.blissbase.app/events/b/LOZTvW10y7U.webp`] },
                { id: 3, slug: `event-c`, imageUrls: [failedImageUrl] },
            ],
            hammingDistanceThreshold: 5,
        });

        expect(duplicates).toEqual(expect.arrayContaining([
            expect.objectContaining({
                eventAId: 1,
                eventBId: 2,
            }),
        ]));
        expect(duplicates.some((duplicate) => duplicate.eventAId === 3 || duplicate.eventBId === 3)).toBe(false);
        expect(errorSpy).toHaveBeenCalledWith(
            `Failed to decode base64 string: Invalid character (cover-image) for event 1 (event-a) https://blissbase.app/event-a image ${validHashUrl} vs event 3 (event-c) https://blissbase.app/event-c image ${failedImageUrl}`,
            {
                failedImageUrl,
                error: expect.any(Error),
            },
        );

        errorSpy.mockRestore();
    });
});

describe(`runDeduplicateSafely`, () => {
    it(`logs a leftover failure and does not throw`, async () => {
        const errorSpy = vi.spyOn(console, `error`).mockImplementation(() => {});
        const failure = new Error(`Failed to decode base64 string: Invalid character (cover-image)`);

        await expect(runDeduplicateSafely(async () => {
            throw failure;
        })).resolves.toBeUndefined();
        expect(errorSpy).toHaveBeenCalledWith(`Deduplication failed:`, failure);

        errorSpy.mockRestore();
    });
});

type TestEvent = {
    id: number,
    slug?: string | null,
    tagSlugs?: string[] | null,
};
