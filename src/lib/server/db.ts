import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { AsyncRemoteCallback } from 'drizzle-orm/sqlite-proxy';
import { d1HttpDriver } from '../../drizzle-d1-http';
import * as schema from './schema';
import { dev } from '$app/environment';

let d1Driver: AsyncRemoteCallback;

if (dev) {
    d1Driver = async (sql: string, params: unknown[], method: "all" | "run" | "get" | "values") => {
        if (method === "values") {
            const result = await d1HttpDriver(sql, params, "all");
            return result;
        }
        return d1HttpDriver(sql, params, method);
    };

} else {
    d1Driver = env.DB;
}

const db = drizzle(d1Driver, { schema });


export default db;

export type DrizzleClient = typeof db;