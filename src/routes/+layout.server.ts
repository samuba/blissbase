import type { LayoutServerLoad } from './$types';

export const load = (async ({ locals, cookies }) => {
    return {
        userId: locals.userId,
        cookies: cookies.getAll(),
        jwtClaims: locals.jwtClaims,
        isAdminSession: locals.isAdminSession,
    };
}) satisfies LayoutServerLoad;
