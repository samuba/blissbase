import { ADMIN_USER_ID } from '$env/static/private';
import { isAdminSession } from '$lib/server/admin';
import type { LayoutServerLoad } from './$types';

export const load = (async () => {
    const userId = isAdminSession() ? ADMIN_USER_ID : undefined
    return {
        userId
    };
}) satisfies LayoutServerLoad;