import { defineEnvVars } from "@sveltejs/kit/env";

export const variables = defineEnvVars({
	E2E_TEST: { static: true },
	PUBLIC_SUPABASE_PUBLISHABLE_KEY: { public: true, static: true },
	PUBLIC_SUPABASE_URL: { public: true, static: true },
	TELEGRAM_BOT_TOKEN: { static: true },
	GOOGLE_MAPS_API_KEY: { static: true },
	S3_ACCESS_KEY_ID: { static: true },
	S3_SECRET_ACCESS_KEY: { static: true },
	S3_BUCKET_NAME: { static: true },
	CLOUDFLARE_ACCOUNT_ID: { static: true },
	// Optional / multi-account fields: empty string when unset is intentional.
	CRON_SECRET: { schema: (input) => input ?? "" },
	TELEGRAM_APP_ID: { schema: (input) => input ?? "" },
	TELEGRAM_APP_HASH: { schema: (input) => input ?? "" },
	TELEGRAM_APP_SESSION_PRIMARY: { schema: (input) => input ?? "" },
	TELEGRAM_APP_SESSION_FALLBACK: { schema: (input) => input ?? "" },
	TELEGRAM_APP_SESSION: { schema: (input) => input ?? "" },
	PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY: { public: true, static: true },
	ADMIN_EMAILS: { static: true },
	RESEND_API_KEY: { static: true },
});
