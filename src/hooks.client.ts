import posthog from 'posthog-js';
import type { HandleClientError } from '@sveltejs/kit';
import { dev } from '$app/environment';

export const handleError: HandleClientError = async ({ error, status }) => {
    if (!dev && status !== 404) {
        posthog.captureException(error);
    }
};