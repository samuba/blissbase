export const routes = {
    searchPage: (page?: number, limit?: number, startDate?: string | null, endDate?: string | null) => {
        const params = new URLSearchParams();

        if (page !== undefined) params.set('page', page.toString());
        if (limit !== undefined) params.set('limit', limit.toString());
        if (startDate) params.set('startDate', startDate);
        if (endDate) params.set('endDate', endDate);

        const queryString = params.toString();
        return `/${queryString ? '?' + queryString : ''}`;
    },
}
