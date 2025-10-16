import { prerender } from "$app/server";
import { db, s } from "$lib/server/db";
import { desc, inArray, sql } from "drizzle-orm";

export const getTags = prerender(async () => {
    const result = await db.query.tags.findMany({
        with: {
            translations: true,
        },
        orderBy: [
            desc(sql`(SELECT COUNT(*) FROM event_tags WHERE event_tags.tag_id = tags.id)`),
        ],
    });

    const previewTagSlugs = ['yoga', 'meditation', 'breathwork', 'tantra', 'conscious-dance', 'cacao-ceremony']
    const previewTags = await db.query.tags.findMany({
        with: {
            translations: true,
        },
        where: inArray(s.tags.slug, previewTagSlugs)
    })
    previewTags.sort((a, b) => previewTagSlugs.indexOf(a.slug) - previewTagSlugs.indexOf(b.slug));


    return {
        allTags: buildUiTags(result),
        previewTags: buildUiTags(previewTags),
    }
});

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