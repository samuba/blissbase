import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, s } from '#lib/server/db.ts';
import { findImageHashDuplicatePairs, getDuplicateEventsByTextSimilarity, getFormCreatedDeduplicationPlan, getMergedSourceUrl, preparePreferredSourceEventUpdate, processDuplicates } from './remove-duplicates.ts';

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

describe(`getDuplicateEventsByTextSimilarity`, () => {
    const source = `dedupe-text-test`;

    beforeEach(async () => {
        await db.delete(s.events).where(eq(s.events.source, source));
    });

    it(`compares descriptions only for events that share a start time inside the lookback`, async () => {
        const upcomingStart = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        const recentStart = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        const oldStart = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
        const otherUpcomingStart = new Date(upcomingStart.getTime() + 60 * 60 * 1000);
        const sameDescription = `Morning breathwork and cacao ceremony by the lake with live music`;

        const inserted = await db.insert(s.events).values([
            textSimilarityEvent({ source, slug: `dedupe-upcoming-a`, startAt: upcomingStart, description: sameDescription }),
            textSimilarityEvent({ source, slug: `dedupe-upcoming-b`, startAt: upcomingStart, description: sameDescription }),
            textSimilarityEvent({ source, slug: `dedupe-upcoming-other`, startAt: otherUpcomingStart, description: sameDescription }),
            textSimilarityEvent({ source, slug: `dedupe-upcoming-unlike`, startAt: upcomingStart, description: `Quarterly spreadsheet training for invoice reconciliation` }),
            textSimilarityEvent({ source, slug: `dedupe-recent-a`, startAt: recentStart, description: sameDescription }),
            textSimilarityEvent({ source, slug: `dedupe-recent-b`, startAt: recentStart, description: sameDescription }),
            textSimilarityEvent({ source, slug: `dedupe-old-a`, startAt: oldStart, description: sameDescription }),
            textSimilarityEvent({ source, slug: `dedupe-old-b`, startAt: oldStart, description: sameDescription }),
            textSimilarityEvent({ source, slug: `dedupe-upcoming-blank`, startAt: upcomingStart, description: null }),
        ]).returning({ id: s.events.id, slug: s.events.slug });

        const idBySlug = new Map(inserted.map((row) => [row.slug, row.id]));
        const duplicates = await getDuplicateEventsByTextSimilarity({
            descriptionSimilarityThreshold: 0.5,
            database: db,
        });
        const ownIds = new Set(inserted.map((row) => row.id));
        const ownPairs = duplicates.filter((duplicate) => ownIds.has(duplicate.eventAId) && ownIds.has(duplicate.eventBId));
        const pairKeys = ownPairs.map((duplicate) => [duplicate.eventAId, duplicate.eventBId].sort((a, b) => a - b).join(`:`));

        expect(pairKeys).toEqual(expect.arrayContaining([
            pairKey(idBySlug, `dedupe-upcoming-a`, `dedupe-upcoming-b`),
            pairKey(idBySlug, `dedupe-recent-a`, `dedupe-recent-b`),
        ]));
        expect(pairKeys).toHaveLength(2);
        expect(ownPairs.every((duplicate) => duplicate.dist >= 0.5)).toBe(true);
        expect(ownPairs[0]?.dist).toBeGreaterThanOrEqual(ownPairs[1]?.dist ?? 0);
    });
});

function textSimilarityEvent(args: {
    source: string,
    slug: string,
    startAt: Date,
    description: string | null,
}) {
    return {
        name: `Dedupe text test`,
        startAt: args.startAt,
        address: [`Berlin`],
        imageUrls: [`https://example.com/${args.slug}.webp`],
        source: args.source,
        slug: args.slug,
        description: args.description,
    };
}

function pairKey(idBySlug: Map<string, number>, slugA: string, slugB: string) {
    const idA = idBySlug.get(slugA);
    const idB = idBySlug.get(slugB);
    if (idA == null || idB == null) throw new Error(`missing inserted event`);
    return [idA, idB].sort((a, b) => a - b).join(`:`);
}

type TestEvent = {
    id: number,
    tagSlugs: string[] | null,
};
