import type { Handle } from '@sveltejs/kit';
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

// load at server startup
loadLocales(main.key, main.loadIDs, main.loadCatalog, locales)
loadLocales(js.key, js.loadIDs, js.loadCatalog, locales)
const wuchaleLocalization: Handle = async ({ event, resolve }) => {
    let locale = event.cookies.get('locale')
    if (!locale) { 
        locale = 'en'
    } else {
        event.cookies.set('locale', locale, { path: '/' });
    }
    localeStore.locale = locale;
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

const supabaseAuth: Handle = async ({ event, resolve }) => {
    event.locals.isAdminSession = isAdminSession();
    event.locals.supabase = createSupabaseServerClient();

    const { error, data } = await event.locals.supabase.auth.getClaims();
    if (error) console.error('claimsError', error);
    event.locals.jwtClaims = data?.claims as BlissabaseClaims;
    event.locals.userId = event.locals.jwtClaims?.sub;

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
            wuchaleLocalization,
            extractVercelHeader,
            insertPosthog,
            supabaseAuth,
        )({ event, resolve });
    } finally {
        if (!dev) waitUntil(posthog.shutdown())
    }
}