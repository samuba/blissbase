export interface SearchPageArgs {
    page?: number;
    limit?: number;
    startDate?: string | null;
    endDate?: string | null;
    plzCity?: string | null;
    distance?: string | null;
    lat?: number | null;
    lng?: number | null;
}

export const routes = {
    searchPage: (args: SearchPageArgs = {}) => {
        const params = new URLSearchParams();
        const { page, limit, startDate, endDate, plzCity, distance, lat, lng } = args;

        if (page !== undefined) params.set('page', page.toString());
        if (limit !== undefined) params.set('limit', limit.toString());
        if (startDate) params.set('startDate', startDate);
        if (endDate) params.set('endDate', endDate);
        if (plzCity) params.set('plzCity', plzCity);
        if (distance) params.set('distance', distance);
        if (lat !== undefined && lat !== null) params.set('lat', lat.toString());
        if (lng !== undefined && lng !== null) params.set('lng', lng.toString());

        const queryString = params.toString();
        return `/${queryString ? '?' + queryString : ''}`;
    },
}
