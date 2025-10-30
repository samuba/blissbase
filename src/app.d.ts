// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { PostHog } from 'posthog-node';
import type { SupabaseClient } from '@supabase/supabase-js';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			posthog: PostHog;
			posthogDistinctId: string | undefined;
			supabase: SupabaseClient;
			jwtClaims: BlissabaseClaims | undefined;
			isAdminSession: boolean;
			userId: string | undefined;
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

	type BlissabaseClaims =  {
		iss: string
		sub: string
		aud: string
		exp: number
		iat: number
		email: string
		phone: string
		app_metadata: {
		  provider: string
		  providers: Array<string>
		}
		user_metadata: {
		  email: string
		  email_verified: boolean
		  phone_verified: boolean
		  sub: string
		}
		role: string
		aal: string
		amr: Array<{
		  method: string
		  timestamp: number
		}>
		session_id: string
		is_anonymous: boolean
	  }
}
