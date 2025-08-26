export const BASE_URL = "https://blissbase.app" as const

export interface SearchPageArgs {
    searchTerm?: string | null;
}

export const routes = {
    eventList: (args: SearchPageArgs = {}) => {
        const params = new URLSearchParams();
        const { searchTerm } = args;

        if (searchTerm) params.set('searchTerm', searchTerm);

        const queryString = params.toString();

        if (queryString) {
            return `/${queryString}`;
        }

        return "/"
    },
    eventDetails: (slug: string, absolute: boolean = false) => {
        const base = absolute ? `${BASE_URL}/` : "/";
        return `${base}${slug}`
    },
    sources: () => '/sources',
    newEvent: () => '/new',
    editEvent: (id: number, hostSecret?: string, absolute: boolean = false) => {
        const base = absolute ? `${BASE_URL}/` : "/";
        const params = new URLSearchParams();
        if (hostSecret) params.set('hostSecret', hostSecret);
        if (params.size === 0) return `${base}/edit/${id}?_ADMIN_LINK_NICHT_TEILEN`;
        return `${base}/edit/${id}?${params.toString()}`
    }
}
