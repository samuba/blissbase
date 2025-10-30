import type { LayoutServerLoad } from './$types';

export const load = (async ({ locals, cookies }) => {
    // For PostHog identification: prioritize Supabase user, then admin, then undefined
    const userId = await locals.jwtClaims?.sub;
    return {
        userId,
        cookies: cookies.getAll(),
        jwtClaims: locals.jwtClaims,
        isAdminSession: locals.isAdminSession,
    };
}) satisfies LayoutServerLoad;