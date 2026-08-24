import posthog from 'posthog-js';
import type { HandleClientError } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { isBrowserNoiseException } from '$lib/posthog';

export const handleError: HandleClientError = async ({ error, status }) => {
	if (isBrowserNoiseException(error)) return;

	console.error(error);
	if (!dev && status !== 404) {
		posthog.captureException(error);
	}
};
