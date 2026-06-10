import { getRequestEvent } from '$app/server';
import { isAdminSession } from '$lib/server/admin';

export async function refreshAuthLocalsFromSupabase() {
	const { locals } = getRequestEvent();
	const { error, data } = await locals.supabase.auth.getClaims();
	if (error) console.error(`claimsError`, error);
	setAuthLocalsFromClaims(data?.claims as BlissabaseClaims | undefined);
}

export function setAuthLocalsFromClaims(claims: BlissabaseClaims | undefined) {
	const { locals } = getRequestEvent();
	locals.jwtClaims = claims;
	locals.userId = locals.jwtClaims?.sub;
	locals.isAdminSession = isAdminSession();
}
