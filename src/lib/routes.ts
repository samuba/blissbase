export interface SearchPageArgs {
    page?: number;
    limit?: number;
    startDate?: string | null;
    endDate?: string | null;
    plzCity?: string | null;
    distance?: string | null;
    lat?: number | null;
    lng?: number | null;
    searchTerm?: string | null;
    sortBy?: string | null;
    sortOrder?: string | null;
}

export const routes = {
    eventList: () => '/',
    eventDetails: (slug: string) => `/${slug}`,
    searchPage: (args: SearchPageArgs = {}) => {
        const params = new URLSearchParams();
        const { page, limit, startDate, endDate, plzCity, distance, lat, lng, searchTerm, sortBy, sortOrder } = args;

        if (page !== undefined) params.set('page', page.toString());
        if (limit !== undefined) params.set('limit', limit.toString());
        if (startDate) params.set('startDate', startDate);
        if (endDate) params.set('endDate', endDate);
        if (plzCity) params.set('plzCity', plzCity);
        if (distance) params.set('distance', distance);
        if (lat !== undefined && lat !== null) params.set('lat', lat.toString());
        if (lng !== undefined && lng !== null) params.set('lng', lng.toString());
        if (searchTerm) params.set('searchTerm', searchTerm);
        if (sortBy) params.set('sortBy', sortBy);
        if (sortOrder) params.set('sortOrder', sortOrder);

        const queryString = params.toString();
        return `/${queryString ? '?' + queryString : ''}`;
    },
    sources: () => '/sources',
}
