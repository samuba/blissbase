import 'varlock/auto-load';
import { defineConfig } from "drizzle-kit";

export default defineConfig({
	schema: `./src/lib/server/schema.ts`,
	out: `./migrations`,
	dialect: `postgresql`,
	extensionsFilters: [`postgis`],
	dbCredentials: {
		url: process.env.DATABASE_URL_NON_POOLING!,
	},
	casing: `snake_case`
});
