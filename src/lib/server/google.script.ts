import { db } from './db.script';
import { createGoogleCacheApi } from './google.shared';

export const { geocodeAddressCached, reverseGeocodeCityCached } = createGoogleCacheApi(db);
