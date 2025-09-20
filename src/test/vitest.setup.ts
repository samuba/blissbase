/**
 * Test setup file for vitest
 * This file is automatically run before all tests
 */

// Global test setup can go here if needed
// For example, setting up global mocks, timeouts, etc.
import { vi } from "vitest";

// Set environment variables for testing
process.env.NODE_ENV = 'test';
process.env.VITEST = 'true';

// Mock environment variables that might be required
if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
}

vi.mock("$lib/server/db", async (importOriginal) => {
    const { s: schema, db: _db, ...rest } = await importOriginal<typeof import("../lib/server/db")>()

    const { PGlite } = await vi.importActual<typeof import("@electric-sql/pglite")>("@electric-sql/pglite")
    const { drizzle } = await vi.importActual<typeof import("drizzle-orm/pglite")>("drizzle-orm/pglite")
    const { cube } = await vi.importActual<typeof import("@electric-sql/pglite/contrib/cube")>("@electric-sql/pglite/contrib/cube");
    const { earthdistance } = await vi.importActual<typeof import("@electric-sql/pglite/contrib/earthdistance")>("@electric-sql/pglite/contrib/earthdistance");
    const { pg_trgm } = await vi.importActual<typeof import("@electric-sql/pglite/contrib/pg_trgm")>("@electric-sql/pglite/contrib/pg_trgm");

    // const { pushSchema } = require("drizzle-kit/api") as typeof import("drizzle-kit/api")

    const client = new PGlite({ extensions: { cube, earthdistance, pg_trgm } })
    const db = drizzle(client, { schema, casing: 'snake_case' })

    // Explicitly create the extensions (cube must come before earthdistance)
    await client.exec('CREATE EXTENSION IF NOT EXISTS cube;')
    await client.exec('CREATE EXTENSION IF NOT EXISTS earthdistance;')
    await client.exec('CREATE EXTENSION IF NOT EXISTS pg_trgm;')

    await pushSchema(db, schema)

    // seed test data
    // await db
    //     .insert(User)
    //     .values({ email: "email@email.email", externalId: "external" })

    return { db, s: schema, ...rest }
})

// needed cuz pushSchema does not respect casing https://github.com/drizzle-team/drizzle-orm/issues/3913
async function pushSchema(db: any, schema: any) {
    // use require to defeat dynamic require error (https://github.com/drizzle-team/drizzle-orm/issues/2853#issuecomment-2668459509)
    const { createRequire } = await vi.importActual<typeof import("node:module")>("node:module")
    const require = createRequire(import.meta.url)
    const { generateDrizzleJson, generateMigration } = require('drizzle-kit/api') as typeof import('drizzle-kit/api')

    const prevJson = generateDrizzleJson({})
    const curJson = generateDrizzleJson(
        schema,
        prevJson.id,
        undefined,
        'snake_case'
    )

    const statements = await generateMigration(prevJson, curJson)

    for (const statement of statements) {
        await db.execute(statement)
    }
}