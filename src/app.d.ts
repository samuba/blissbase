// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
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
			env: {
				DB: D1Database;
			};
			context: {
				waitUntil(promise: Promise<unknown>): void;
			};
			caches: CacheStorage & { default: Cache };
		}
	}
}

import 'telefunc'

declare module 'telefunc' {
	namespace Telefunc {
		interface Context {
			/* Globally define the type of the `context` object here, see https://telefunc.com/getContext#typescript
			 * For example:
			 user: null | { id: number, name: string }
			 */
		}
	}
}