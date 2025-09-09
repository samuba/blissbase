import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import type { HandleServerError } from '@sveltejs/kit';
import { PostHog } from 'posthog-node';
import { dev } from '$app/environment';
import { isAdminSession } from '$lib/server/admin';
import { ADMIN_USER_ID } from '$env/static/private';
import { waitUntil } from '@vercel/functions';

const extractVercelHeader: Handle = async ({ event, resolve }) => {
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

const insertUserInfo: Handle = async ({ event, resolve }) => {
    event.locals.user = { id: isAdminSession() ? ADMIN_USER_ID : event.locals.posthogDistinctId }
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
            extractVercelHeader,
            insertPosthog,
            insertUserInfo
        )({ event, resolve });
    } finally {
        if (!dev) waitUntil(posthog.shutdown())
    }
}