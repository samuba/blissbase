import { getRequestEvent } from '$app/server';
import { ADMIN_SECRET } from '$env/static/private';

const ADMIN_COOKIE_NAME = 'blissbase_admin';
const neverExpire = 60 * 60 * 24 * 999999;

export function setAdminCookie() {
    try {
        const cookies = getRequestEvent().cookies
        cookies.set(ADMIN_COOKIE_NAME, ADMIN_SECRET, {
            path: '/',
            maxAge: neverExpire,
            httpOnly: true, // deny js access to the cookie (e.g. document.cookie)
            secure: true, // only send the cookie over https (MITM protection)
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
        const isAdmin = isAdminSecret(cookieValue);
        if (isAdmin) console.log('@@@ This is an admin session @@@');
        return isAdmin;
    } catch (error) {
        console.error('Failed to validate admin cookie:', error);
        return false;
    }
}

export function isAdminSecret(secret: string | undefined): boolean {
    return secret === ADMIN_SECRET;
}