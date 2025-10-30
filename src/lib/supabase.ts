import { createBrowserClient } from '@supabase/ssr';
import { PUBLIC_SUPABASE_PUBLISHABLE_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import { browser } from '$app/environment';
import type { SupabaseClient } from '@supabase/supabase-js';

export function createSupabaseBrowserClient() {
	if (!browser) {
		throw new Error(`createSupabaseBrowserClient can only be called in the browser`);
	}

	if (globalThis.__supabaseClient) {
		return globalThis.__supabaseClient;
	}

	const client = createBrowserClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY);
	globalThis.__supabaseClient = client;
	
	return client;
}

// Type augmentation for the global supabase client
declare global {
	// eslint-disable-next-line no-var
	var __supabaseClient:  SupabaseClient<any, "public", "public", any, any> | undefined;
}

