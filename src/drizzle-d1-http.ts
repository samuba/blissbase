// from https://gist.github.com/flopex/8ba626b2dc650947882d3f45769c4702

import ky from 'ky';
import "dotenv/config";
import type { AsyncBatchRemoteCallback } from 'drizzle-orm/sqlite-proxy';

const { CLOUDFLARE_D1_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_DATABASE_ID } = process.env;

if (!CLOUDFLARE_D1_TOKEN || !CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_DATABASE_ID) {
    throw new Error('Missing Cloudflare D1 credentials');
}

const D1_API_BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${CLOUDFLARE_DATABASE_ID}`

const d1HttpClient = ky.create({
    prefixUrl: D1_API_BASE_URL,
    headers: {
        Authorization: `Bearer ${CLOUDFLARE_D1_TOKEN}`,
    },
});

export type AsyncRemoteCallback = (
    sql: string,
    params: unknown[],
    method: 'all' | 'run' | 'get' | 'values'
) => Promise<{ rows: any }>;

export const d1HttpDriver = async (
    sql: string,
    params: unknown[],
    method: 'all' | 'run' | 'get'
) => {
    const res = await d1HttpClient.post('query', {
        json: { sql, params, method },
    });

    const data = (await res.json()) as Record<string, any>;

    if (data.errors.length > 0 || !data.success) {
        throw new Error(
            `Error from sqlite proxy server: \n${JSON.stringify(data)}}`
        );
    }

    const qResult = data.result[0];

    if (!qResult.success) {
        throw new Error(
            `Error from sqlite proxy server: \n${JSON.stringify(data)}`
        );
    }

    // https://orm.drizzle.team/docs/get-started-sqlite#http-proxy
    return { rows: qResult.results.map((r: any) => Object.values(r)) };
};

export const d1HttpBatchDriver: AsyncBatchRemoteCallback = async (
    queries: {
        sql: string;
        params: unknown[];
        method: 'all' | 'run' | 'get'
    }[]
): Promise<{ rows: unknown[] }[]> => {
    const results = [];

    for (const query of queries) {
        const { sql, params, method } = query;
        const result = await d1HttpDriver(sql, params, method);
        results.push(result);
    }

    return results;
};

function chunkArray<T>(array: T[], size: number) {
    const result: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size));
    }
    return result;
}