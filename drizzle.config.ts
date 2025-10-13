import { config } from 'dotenv';
import { defineConfig } from "drizzle-kit";

config({ path: '.env' });

export default defineConfig({
	schema: "./src/lib/server/schema.ts",
	out: "./migrations",
	dialect: "postgresql",
	extensionsFilters: ['postgis'],
	dbCredentials: {
		url: process.env.DATABASE_URL_NON_POOLING!,
	},
	casing: "snake_case"
});