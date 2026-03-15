import 'dotenv/config';
import { createPostgresDrizzle } from './db.shared';

export * from 'drizzle-orm';
export { s } from './db.shared';
export const db = createPostgresDrizzle();
