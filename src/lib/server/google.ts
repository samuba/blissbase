import { db } from './db';
import { createGoogleCacheApi } from './google.shared';

export const { geocodeAddressCached, reverseGeocodeCityCached } = createGoogleCacheApi(db);