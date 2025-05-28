import type { RequestHandler } from './$types';
import { fetchEvents } from '$lib/server/events';
import { json } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ url }) => {
    const params = {
        pageParam: url.searchParams.get('page'),
        limitParam: url.searchParams.get('limit'),
        startDateParam: url.searchParams.get('startDate'),
        endDateParam: url.searchParams.get('endDate'),
        plzCityParam: url.searchParams.get('plzCity'),
        distanceParam: url.searchParams.get('distance'),
        latParam: url.searchParams.get('lat'),
        lngParam: url.searchParams.get('lng'),
        searchTermParam: url.searchParams.get('searchTerm'),
        sortByParam: url.searchParams.get('sortBy'),
        sortOrderParam: url.searchParams.get('sortOrder')
    };

    const result = await fetchEvents(params);
    return json(result);
};