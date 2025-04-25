// import { defineConfig } from 'drizzle-kit';

// if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

// export default defineConfig({
// 	schema: './src/lib/server/db/schema.ts',
// 	dbCredentials: { url: process.env.DATABASE_URL },
// 	verbose: true,
// 	strict: true,
// 	dialect: 'sqlite'
// });

// from https://fiberplane.com/blog/placegoose-to-prod/


import "dotenv/config"; // We use dotenv to grab local environment variables
import { defineConfig } from "drizzle-kit";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const databaseId = process.env.CLOUDFLARE_DATABASE_ID;
const token = process.env.CLOUDFLARE_D1_TOKEN;

// Make sure we actually set our credentials
if (!accountId || !databaseId || !token) {
	console.error(
		`Configuration Failed: Missing Credentials`,
		JSON.stringify({ accountId, databaseId, token }, null, 2)
	);
	process.exit(1);
}

const drizzleConfig = defineConfig({
	schema: "./src/schema.ts",
	out: "./migrations",
	dialect: "sqlite",
	driver: "d1-http", // Use the HTTP driver
	dbCredentials: {
		accountId,
		databaseId,
		token
	}
});

export default drizzleConfig;