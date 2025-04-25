// from https://gist.github.com/flopex/8ba626b2dc650947882d3f45769c4702

import type { AsyncBatchRemoteCallback } from 'drizzle-orm/sqlite-proxy';

const { CLOUDFLARE_D1_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_DATABASE_ID } = process.env;

if (!CLOUDFLARE_D1_TOKEN || !CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_DATABASE_ID) {
    throw new Error('Missing Cloudflare D1 credentials');
}

const D1_API_BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${CLOUDFLARE_DATABASE_ID}`

export type AsyncRemoteCallback = (
    sql: string,
    params: unknown[],
    method: 'all' | 'run' | 'get' | 'values'
) => Promise<{ rows: unknown[] }>;

export const d1HttpDriver = async (
    sql: string,
    params: unknown[],
    method: 'all' | 'run' | 'get'
) => {
    const res = await fetch(`${D1_API_BASE_URL}/query`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${CLOUDFLARE_D1_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql, params, method }),
    });

    const data = (await res.json()) as Record<string, unknown>;

    if (Array.isArray(data.errors) && data.errors.length > 0 || data.success === false) {
        throw new Error(
            `Error from sqlite proxy server: \n${JSON.stringify(data)}}`
        );
    }

    const qResult = (data.result as unknown[])[0] as Record<string, unknown>;

    if (qResult.success === false) {
        throw new Error(
            `Error from sqlite proxy server: \n${JSON.stringify(data)}`
        );
    }

    // https://orm.drizzle.team/docs/get-started-sqlite#http-proxy
    return { rows: (qResult.results as Record<string, unknown>[]).map((r) => Object.values(r)) };
};

export const d1HttpBatchDriver: AsyncBatchRemoteCallback = async (
    queries: {
        sql: string;
        params: unknown[];
        method: 'all' | 'run' | 'get' | 'values';
    }[]
): Promise<{ rows: unknown[] }[]> => {
    const results = [];

    for (const query of queries) {
        const { sql, params, method } = query;
        // Cast method to compatible type for d1HttpDriver
        const compatMethod = method === 'values' ? 'all' : method;
        const result = await d1HttpDriver(sql, params, compatMethod);
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