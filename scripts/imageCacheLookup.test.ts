import { beforeEach, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { db, s } from '#lib/server/db.ts';
import { imageCacheMapKey, loadImageCacheByKeys, lookupImageCacheRows } from './imageCacheLookup.ts';

describe(`loadImageCacheByKeys`, () => {
    const originalUrls = [
        `https://example.com/cache-a.jpg`,
        `https://example.com/cache-b.jpg`,
        `https://example.com/cache-c.jpg`,
    ];

    beforeEach(async () => {
        await db.delete(s.imageCacheMap).where(inArray(s.imageCacheMap.originalUrl, originalUrls));
        await db.insert(s.imageCacheMap).values([
            { originalUrl: originalUrls[0], eventSlug: `event-a`, url: `https://assets.example/a.webp` },
            { originalUrl: originalUrls[0], eventSlug: `event-a-other`, url: `https://assets.example/a-other.webp` },
            { originalUrl: originalUrls[1], eventSlug: `event-b`, url: `https://assets.example/b.webp` },
            { originalUrl: originalUrls[2], eventSlug: `event-c`, url: `https://assets.example/c.webp` },
        ]);
    });

    it(`looks up only the requested primary-key pairs, in batches`, async () => {
        const keys = [
            { originalUrl: originalUrls[0], eventSlug: `event-a` },
            { originalUrl: originalUrls[0], eventSlug: `event-a` },
            { originalUrl: originalUrls[1], eventSlug: `event-b` },
            { originalUrl: `https://example.com/missing.jpg`, eventSlug: `event-missing` },
        ];
        const batches: number[] = [];
        const cacheByKey = await loadImageCacheByKeys({
            keys,
            batchSize: 1,
            lookup: async (batch) => {
                batches.push(batch.length);
                return lookupImageCacheRows({ db, keys: batch });
            },
        });

        expect(batches).toEqual([1, 1, 1]);
        expect(cacheByKey.get(imageCacheMapKey({ eventSlug: `event-a`, originalUrl: originalUrls[0] }))).toBe(`https://assets.example/a.webp`);
        expect(cacheByKey.get(imageCacheMapKey({ eventSlug: `event-b`, originalUrl: originalUrls[1] }))).toBe(`https://assets.example/b.webp`);
        expect(cacheByKey.has(imageCacheMapKey({ eventSlug: `event-a-other`, originalUrl: originalUrls[0] }))).toBe(false);
        expect(cacheByKey.has(imageCacheMapKey({ eventSlug: `event-c`, originalUrl: originalUrls[2] }))).toBe(false);
        expect(cacheByKey.size).toBe(2);
    });

    it(`does not query when there are no keys`, async () => {
        const cacheByKey = await loadImageCacheByKeys({
            keys: [],
            lookup: async () => {
                throw new Error(`lookup should not run`);
            },
        });

        expect(cacheByKey.size).toBe(0);
    });
});
