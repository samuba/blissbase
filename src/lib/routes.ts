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
    eventDetails: (slug: string) => `/${slug}`,
    sources: () => '/sources',
}
