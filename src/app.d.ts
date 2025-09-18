// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { PostHog } from 'posthog-node';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			posthog: PostHog;
			posthogDistinctId: string | undefined;
			user: { id: string | undefined };
			requestInfo: {
				ip: string | null;
				continent: string | null;
				country: string | null;
				region: string | null;
				city: string | null;
				latitude: number | null;
				longitude: number | null;
				timezone: string | null;
				postalCode: string | null;
			};
		}
		// interface PageData {}
		interface PageState {
			selectedEventId?: number;
		}
		interface Platform {
			caches: CacheStorage & { default: Cache };
		}
	}

	type Simplify<T> = { [KeyType in keyof T]: T[KeyType] } & {};
}