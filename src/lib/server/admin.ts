import { getRequestEvent } from '$app/server';
import { ADMIN_SECRET } from '$env/static/private';

const ADMIN_COOKIE_NAME = 'blissbase_admin';

export function setAdminCookie() {
    try {
        const cookies = getRequestEvent().cookies
        cookies.set(ADMIN_COOKIE_NAME, ADMIN_SECRET, {
            path: '/',
            maxAge: 60 * 60 * 24 * 999999, // never expire
            httpOnly: true,
            secure: true,
            sameSite: 'lax' as const
        });
        return true;
    } catch (error) {
        console.error('Failed to set admin cookie:', error);
        return false;
    }
}

export function isAdminSession(): boolean {
    try {
        const cookieValue = getRequestEvent().cookies.get(ADMIN_COOKIE_NAME);
        console.log('isAdminSession', isAdminSecret(cookieValue));
        return isAdminSecret(cookieValue);
    } catch (error) {
        console.error('Failed to validate admin cookie:', error);
        return false;
    }
}

export function isAdminSecret(secret: string | undefined): boolean {
    return secret === ADMIN_SECRET;
}