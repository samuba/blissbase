import { sql, type SQL } from 'drizzle-orm';
import { s } from '../src/lib/server/db.shared.ts';

const defaultImageCacheLookupBatchSize = 200;

/**
 * Loads cached image URLs for the given (originalUrl, eventSlug) pairs.
 * The primary key is that pair, so each batch is an index lookup.
 *
 * @example
 * await loadImageCacheByKeys({ keys: [{ originalUrl, eventSlug }], lookup })
 */
export async function loadImageCacheByKeys(args: {
    keys: ImageCacheKey[],
    lookup: (keys: ImageCacheKey[]) => Promise<CachedImage[]>,
    batchSize?: number,
}) {
    const uniqueKeys = uniqueImageCacheKeys(args.keys);
    const cacheByKey = new Map<string, string>();
    if (!uniqueKeys.length) return cacheByKey;

    const batchSize = args.batchSize ?? defaultImageCacheLookupBatchSize;
    for (let offset = 0; offset < uniqueKeys.length; offset += batchSize) {
        const batch = uniqueKeys.slice(offset, offset + batchSize);
        const rows = await args.lookup(batch);
        for (const row of rows) {
            cacheByKey.set(imageCacheMapKey(row), row.url);
        }
    }

    return cacheByKey;
}

export function imageCacheMapKey(args: ImageCacheKey) {
    return `${args.eventSlug}\0${args.originalUrl}`;
}

export function imageCacheKeysIn(keys: ImageCacheKey[]) {
    return sql`(${s.imageCacheMap.originalUrl}, ${s.imageCacheMap.eventSlug}) in (${sql.join(
        keys.map((key) => sql`(${key.originalUrl}, ${key.eventSlug})`),
        sql`, `,
    )})`;
}

export async function lookupImageCacheRows(args: {
    db: ImageCacheDb,
    keys: ImageCacheKey[],
}) {
    return args.db
        .select({
            originalUrl: s.imageCacheMap.originalUrl,
            eventSlug: s.imageCacheMap.eventSlug,
            url: s.imageCacheMap.url,
        })
        .from(s.imageCacheMap)
        .where(imageCacheKeysIn(args.keys));
}

function uniqueImageCacheKeys(keys: ImageCacheKey[]) {
    const seen = new Set<string>();
    const unique: ImageCacheKey[] = [];
    for (const key of keys) {
        if (!key.originalUrl || !key.eventSlug) continue;
        const mapKey = imageCacheMapKey(key);
        if (seen.has(mapKey)) continue;
        seen.add(mapKey);
        unique.push(key);
    }
    return unique;
}

type ImageCacheKey = {
    originalUrl: string,
    eventSlug: string,
};

type CachedImage = ImageCacheKey & {
    url: string,
};

type ImageCacheDb = {
    select: (fields: {
        originalUrl: typeof s.imageCacheMap.originalUrl,
        eventSlug: typeof s.imageCacheMap.eventSlug,
        url: typeof s.imageCacheMap.url,
    }) => {
        from: (table: typeof s.imageCacheMap) => {
            where: (predicate: SQL) => PromiseLike<CachedImage[]>,
        },
    },
};
