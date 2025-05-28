import { fetchEvents } from "$lib/server/events";
import type { PageServerLoad } from "./$types";


export const load = (async ({ url }) => {
    const pageStr = url.searchParams.get('page');
    const limitStr = url.searchParams.get('limit');
    const latStr = url.searchParams.get('lat');
    const lngStr = url.searchParams.get('lng');

    const params = {
        pageParam: pageStr ? parseInt(pageStr, 10) : null,
        limitParam: limitStr ? parseInt(limitStr, 10) : null,
        startDateParam: url.searchParams.get('startDate'),
        endDateParam: url.searchParams.get('endDate'),
        plzCityParam: url.searchParams.get('plzCity'),
        distanceParam: url.searchParams.get('distance'),
        latParam: latStr ? parseFloat(latStr) : null,
        lngParam: lngStr ? parseFloat(lngStr) : null,
        searchTermParam: url.searchParams.get('searchTerm'),
        sortByParam: url.searchParams.get('sortBy'),
        sortOrderParam: url.searchParams.get('sortOrder')
    };

    return await fetchEvents(params);
}) satisfies PageServerLoad;
