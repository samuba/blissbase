import { query } from '$app/server';
import { isAdminSession } from '$lib/server/admin';

export const getIsAdminSession = query(async () => isAdminSession());
