import { getRequestEvent } from '$app/server';
import { ADMIN_EMAILS } from '$env/static/private';

const adminEmails = ADMIN_EMAILS.split(",")?.map((email) => email?.trim())?.filter(x => x);

export function isAdminSession(): boolean {
    try {
        const { locals } = getRequestEvent();
        return adminEmails.some(x => x === locals.jwtClaims?.email)
    } catch (error) {
        console.error('Failed to find out if this is admin session', error);
        return false;
    }
}