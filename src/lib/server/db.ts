import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { AsyncRemoteCallback } from 'drizzle-orm/sqlite-proxy';
import * as schema from './schema';
import { dev, building } from '$app/environment';
import { getRequestEvent } from '$app/server';

let d1Driver: AsyncRemoteCallback;

let d1HttpDriverInstance: typeof import('../../drizzle-d1-http').d1HttpDriver | undefined;

if (dev || building) {
    if (!d1HttpDriverInstance) {
        d1HttpDriverInstance = (await import('../../drizzle-d1-http')).d1HttpDriver
    }

    const driver = d1HttpDriverInstance;
    if (!driver) {
        throw new Error('Failed to load d1HttpDriver');
    }

    d1Driver = async (sql: string, params: unknown[], method: "all" | "run" | "get" | "values") => {
        if (method === "values") {
            const result = await driver(sql, params, "all");
            return result;
        }
        return driver(sql, params, method);
    };
} else {
    const requestEvent = getRequestEvent();
    d1Driver = requestEvent.platform?.env.DB
}

export const db = drizzle(d1Driver, { schema });

export type DrizzleClient = typeof db;