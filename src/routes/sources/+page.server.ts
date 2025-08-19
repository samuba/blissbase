import { db } from '$lib/server/db';

export const load = (async () => {
    const targets = await db.query.telegramScrapingTargets.findMany({
        columns: {
            roomId: true,
            name: true,
            lastMessageId: true,
        },
        orderBy: (t, { asc }) => [asc(t.name)],
    })

    return {
        scrapingTargets: targets.filter(x => x.name)
    };
});