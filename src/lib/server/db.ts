import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { AsyncRemoteCallback } from 'drizzle-orm/sqlite-proxy';
import * as schema from './schema';
import { dev, building } from '$app/environment';
import { d1HttpDriver } from '../../drizzle-d1-http';
import type { RequestEvent } from '@sveltejs/kit';

export function getDb(requestEvent: RequestEvent<Partial<Record<string, string>>, string | null>) {
    let d1Driver: AsyncRemoteCallback;
    if (dev || building) {
        d1Driver = async (sql: string, params: unknown[], method: "all" | "run" | "get" | "values") => {
            if (method === "values") {
                const result = await d1HttpDriver(sql, params, "all");
                return result;
            }
            return d1HttpDriver(sql, params, method);
        };
    } else {
        // const requestEvent = getRequestEvent(); makes cloudflare go boom
        d1Driver = requestEvent.platform?.env.DB
    }

    return drizzle(d1Driver, { schema });
}


export type DrizzleClient = ReturnType<typeof getDb>;