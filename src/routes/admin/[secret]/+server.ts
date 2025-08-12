import { error, text } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { setAdminCookie, isAdminSecret } from '$lib/server/admin';

export const GET: RequestHandler = async ({ params }) => {
    if (!isAdminSecret(params.secret)) return error(401, 'Unauthorized');

    const success = setAdminCookie();

    if (!success) return error(500, 'Failed to set admin session');

    return text('Admin session established');
};
