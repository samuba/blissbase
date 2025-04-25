import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { AsyncRemoteCallback } from 'drizzle-orm/sqlite-proxy';
import * as schema from './schema';
import { dev, building } from '$app/environment';
import { getRequestEvent } from '$app/server';
// import { d1HttpDriver } from '../../drizzle-d1-http';

let d1Driver: AsyncRemoteCallback;
dev && building;

// if (dev || building) {
// import("dotenv/config");
// d1Driver = async (sql: string, params: unknown[], method: "all" | "run" | "get" | "values") => {
//     if (method === "values") {
//         const result = await d1HttpDriver(sql, params, "all");
//         return result;
//     }
//     return d1HttpDriver(sql, params, method);
// };
d1Driver = async () => {
    return { rows: [] };
}
// } else {
//     const requestEvent = getRequestEvent();
//     d1Driver = requestEvent.platform?.env.DB
// }

export const db = drizzle(d1Driver, { schema });

export type DrizzleClient = typeof db;
