import { dev } from "$app/environment";
import { prerender } from "$app/server";
import { db, s } from "$lib/server/db";
import { desc, count, eq } from "drizzle-orm";
import type { AllTags } from "$lib/components/TagSelection.devData";

export const getTags = prerender(async () => {
    const firstTagsSlugs = ['breathwork', 'tantra', 'conscious-dance', 'meditation', 'cacao-ceremony', 'kirtan']
    const allTags: AllTags = dev ?
        // prerender is run every load in dev and takes too long, so we just return a dummy result for dev
        (await import('$lib/components/TagSelection.devData')).devDummyData :
        await db.query.tags.findMany({
            with: {
                translations: true,
            },
            orderBy: [
                desc(
                    db
                        .select({ value: count(s.eventTags.eventId) })
                        .from(s.eventTags)
                        .where(eq(s.eventTags.tagId, s.tags.id))
                ),
            ],
        })

    const result = {
        allTags: orderWithFirstSlugs(buildUiTags(allTags), firstTagsSlugs),
    }
    return result;
});

export type UiTag = ReturnType<typeof buildUiTags>[number];

function orderWithFirstSlugs<T extends { slug: string }>(tags: T[], firstSlugs: string[]): T[] {
    const bySlug = new Map(tags.map((t) => [t.slug, t]));
    const first: T[] = [];
    const seen = new Set<string>();
    for (const slug of firstSlugs) {
        if (seen.has(slug)) continue;
        const tag = bySlug.get(slug);
        if (tag) {
            first.push(tag);
            seen.add(slug);
        }
    }
    const rest = tags.filter((t) => !seen.has(t.slug));
    return [...first, ...rest];
}

function buildUiTags(dbTags: {
    id: number;
    createdAt: Date;
    slug: string;
    translations: {
        name: string;
        tagId: number;
        locale: string;
    }[];
}[]) {
    const uiTags = [];
    for (const tag of dbTags) {
        uiTags.push({
            id: tag.id,
            slug: tag.slug,
            en: tag.translations.find(t => t.locale === 'en')?.name,
            de: tag.translations.find(t => t.locale === 'de')?.name,
            nl: tag.translations.find(t => t.locale === 'nl')?.name,
        });
    }
    return uiTags;
}
