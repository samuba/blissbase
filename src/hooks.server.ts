import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { telefuncConfig } from 'telefunc';
import type { HandleServerError } from '@sveltejs/kit';
import { PostHog } from 'posthog-node';



telefuncConfig.disableNamingConvention = true;
telefuncConfig.shield = { dev: true };
telefuncConfig.log = {
    shieldErrors: { dev: true, prod: true }
}

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

export const handle: Handle = sequence(extractVercelHeader)

const client = new PostHog(
    'phc_B5MC1SXojC0n2fXhIf9WCDk6O2cqhdLk7SQCT7eldqZ',
    { host: 'https://eu.i.posthog.com' }
)

export const handleError: HandleServerError = async ({ error, status }) => {
    if (status !== 404) {
        client.captureException(error);
        await client.shutdown();
    }
};
