import { dev } from "$app/environment";
import { prerender } from "$app/server";
import { db, s } from "$lib/server/db";
import { desc, count, eq } from "drizzle-orm";
import type { AllTags } from "./TagSelection.devData";

export const getTags = prerender(async () => {
    const previewTagSlugs = ['meditation', 'breathwork', 'tantra', 'conscious-dance', 'cacao-ceremony', 'kirtan']
    const allTags: AllTags = dev ?
        // prerender is run every load in dev and takes too long, so we just return a dummy result for dev
        (await import('./TagSelection.devData')).devDummyData :
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

    const previewTags = allTags.filter(x => previewTagSlugs.includes(x.slug));
    previewTags.sort((a, b) => previewTagSlugs.indexOf(a.slug) - previewTagSlugs.indexOf(b.slug));

    const result = {
        allTags: buildUiTags(allTags),
        previewTags: buildUiTags(previewTags),
    }
    return result;
});

export type UiTag = ReturnType<typeof buildUiTags>[number];

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