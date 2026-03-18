import { redirect, type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import type { HandleServerError } from '@sveltejs/kit';
import { PostHog } from 'posthog-node';
import { dev } from '$app/environment';
import { waitUntil } from '@vercel/functions';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { isAdminSession } from '$lib/server/admin';
import * as main from './locales/main.loader.server.svelte.js'
import * as js from './locales/js.loader.server.js'
import { runWithLocale, loadLocales } from 'wuchale/load-utils/server';
import { locales } from './locales/data.js'
import { localeStore } from './locales/localeStore.svelte.js';
import { E2E_TEST } from '$env/static/private';
import { resolve as resolveRoute } from '$app/paths';

// load at server startup
loadLocales(main.key, main.loadIDs, main.loadCatalog, locales)
loadLocales(js.key, js.loadIDs, js.loadCatalog, locales)
const wuchaleLocalization: Handle = async ({ event, resolve }) => {
    let locale = event.cookies.get('locale')
    const browserLang = (event.request.headers.get('accept-language') ?? '').split(',')[0]?.split('-')[0]?.trim();
    if (browserLang === "de") {
        // force german locale if browser is german. (this overrides the cookie to fix a bug where wrong locale was set in cookies for some time)
        // TODO: remove this if block in the future when we have a settings to switch language
        locale = "de";
    }
    if (!locale || !locales.includes(locale)) { 
        locale = browserLang && locales.includes(browserLang) ? browserLang : 'en';
    }
    event.cookies.set('locale', locale, { path: '/' });
    localeStore.locale = locale as 'en' | 'de';
    return await runWithLocale(locale, () => resolve(event))
};

const extractVercelHeader: Handle = async ({ event, resolve }) => {
    if (dev) return resolve(event);
    
    const latitude = event.request.headers.get('x-vercel-ip-latitude')
    const longitude = event.request.headers.get('x-vercel-ip-longitude')

    event.locals.requestInfo = {
        ip: event.request.headers.get('x-vercel-ip-address'),
        continent: event.request.headers.get('x-vercel-ip-continent'),
        country: event.request.headers.get('x-vercel-ip-country'),
        region: event.request.headers.get('x-vercel-ip-country-region'),
        city: event.request.headers.get('x-vercel-ip-city'),
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        timezone: event.request.headers.get('x-vercel-ip-timezone'),
        postalCode: event.request.headers.get('x-vercel-ip-postal-code'),
    }
    console.log('requestInfo', event.locals.requestInfo);
    return resolve(event);
}

const posthogApiKey = "phc_B5MC1SXojC0n2fXhIf9WCDk6O2cqhdLk7SQCT7eldqZ"
const posthog = new PostHog(posthogApiKey, { host: 'https://eu.i.posthog.com' })
const insertPosthog: Handle = async ({ event, resolve }) => {
    event.locals.posthog = posthog
    const cookieStr = event.cookies.get(`ph_${posthogApiKey}_posthog`)
    if (cookieStr) {
        try {
            event.locals.posthogDistinctId = JSON.parse(cookieStr).distinct_id
        } catch (error) {
            console.error(`Failed to parse posthog. cookieStr: ${cookieStr}`, error);
        }
    }
    return resolve(event);
}

const clearStaleFilters: Handle = async ({ event, resolve }) => {
    const lastDelete = event.cookies.get('blissbase_filters_last_delete');
    if (lastDelete) {
        return resolve(event);
    }
    
    event.cookies.delete('blissbase_filters', { path: '/' });
    event.cookies.set('blissbase_filters_last_delete', String(Math.floor(Date.now() / 1000)), {
        path: '/',
        maxAge: 60 * 60 * 24 * 365, // 1 year
        httpOnly: false
    });
    
    return resolve(event);
};

const supabaseAuth: Handle = async ({ event, resolve }) => {
    event.locals.isAdminSession = isAdminSession();
    event.locals.supabase = createSupabaseServerClient();

    const { error, data } = await event.locals.supabase.auth.getClaims();
    if (error) console.error('claimsError', error);
    event.locals.jwtClaims = data?.claims as BlissabaseClaims;
    event.locals.userId = event.locals.jwtClaims?.sub;

    if (E2E_TEST === `true` && dev) {
        const e2eUserId = event.cookies.get(`e2e_user_id`);
        const e2eUserEmail = event.cookies.get(`e2e_user_email`);
        if (e2eUserId && e2eUserEmail) {
            event.locals.userId = e2eUserId;
            event.locals.jwtClaims = buildE2EClaims({
                userId: e2eUserId,
                email: e2eUserEmail
            });
        }
    }

    return resolve(event, {
        filterSerializedResponseHeaders(name) {
            /**
             * Supabase libraries use the `content-range` and `x-supabase-api-version`
             * headers, so we need to tell SvelteKit to pass it through.
             */
            return name === 'content-range' || name === 'x-supabase-api-version';
        },
    });
};

const guardRoutesWithLogin: Handle = async ({ event, resolve }) => {
    const { userId } = event.locals;
    ["/new", "/profile"].forEach(route => {
        if (event.url.pathname.startsWith(route) && !userId) {
            redirect(302, resolveRoute('/auth/login'));
        }
    });
    return resolve(event);
}

export const handleError: HandleServerError = async ({ error, status }) => {
    if (status === 404) return; // ignore 404 errors
    console.error(error);

    if (!dev) {
        posthog.captureException(error);
        await posthog.shutdown();
    }
};

export const handle: Handle = async ({ event, resolve }) => {
    try {
        return await sequence(
            clearStaleFilters,
            wuchaleLocalization,
            extractVercelHeader,
            insertPosthog,
            supabaseAuth,
            guardRoutesWithLogin,
        )({ event, resolve });
    } finally {
        if (!dev) waitUntil(posthog.shutdown())
    }
}

/**
 * Creates a minimal JWT claims object for E2E auth bypass.
 *
 * @example
 * buildE2EClaims({ userId: `e2e-user`, email: `e2e@example.com` })
 */
function buildE2EClaims(args: { userId: string; email: string }): BlissabaseClaims {
    const nowSeconds = Math.floor(Date.now() / 1000);
    return {
        iss: `https://e2e.local`,
        sub: args.userId,
        aud: `authenticated`,
        exp: nowSeconds + 60 * 60,
        iat: nowSeconds,
        email: args.email,
        phone: ``,
        app_metadata: {
            provider: `email`,
            providers: [`email`]
        },
        user_metadata: {
            email: args.email,
            email_verified: true,
            phone_verified: false,
            sub: args.userId
        },
        role: `authenticated`,
        aal: `aal1`,
        amr: [{ method: `email`, timestamp: nowSeconds }],
        session_id: `e2e-session`,
        is_anonymous: false
    };
}