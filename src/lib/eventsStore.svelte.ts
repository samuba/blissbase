import type { UiEvent } from '$lib/server/events';
import { fetchEventsWithCookiePersistence } from './events.remote';
import type { DateRangePickerOnChange } from '$lib/components/DateRangePicker.svelte';
import type { LocationChangeEvent } from '$lib/components/LocationDistanceInput.svelte';
import { browser } from '$app/environment';
import { SvelteSet } from 'svelte/reactivity';
import type { AttendanceMode } from './server/schema';

type LoadingState = 'not-loading' | 'loading' | 'loading-more';

type PaginationState = {
    startDate: string | null;
    endDate: string | null;
    page: number;
    limit: number;
    plzCity?: string | null;
    distance?: string | null;
    lat?: number | null;
    lng?: number | null;
    searchTerm?: string | null;
    sortBy?: string | null;
    sortOrder?: string | null;
    tagIds?: number[] | null;
    attendanceMode?: AttendanceMode | null;
    totalEvents?: number | null;
    totalPages?: number | null;
};

function initialPagination() {
    return {
        startDate: null,
        endDate: null,
        page: 1,
        limit: 8,
        sortBy: 'time',
        sortOrder: 'asc',
    } satisfies PaginationState;
}

export class EventsStore {
    events = $state<UiEvent[]>([]);
    pagination = $state<PaginationState>(initialPagination());
    loadingState = $state<LoadingState>('not-loading');
    showTextSearch = $state(false);

    private finishedLoadingCallbacks = new SvelteSet<FinishedLoadingCallback>();

    // Derived reactive values
    selectedSortValue = $derived(this.getSortValue(this.pagination.sortBy, this.pagination.sortOrder));
    isLoading = $derived(this.loadingState === 'loading');
    isLoadingMore = $derived(this.loadingState === 'loading-more');
    hasEvents = $derived(this.events.length > 0);
    canLoadMore = $derived(
        this.loadingState === 'not-loading' &&
        this.pagination.totalPages != null &&
        this.pagination.page < this.pagination.totalPages
    );
    hasSearchFilter = $derived(Boolean(this.pagination.searchTerm?.trim()));
    hasDateFilter = $derived(this.pagination.startDate || this.pagination.endDate);
    hasLocationFilter = $derived(Boolean(this.pagination.plzCity || (this.pagination.lat && this.pagination.lng)));
    hasSortFilter = $derived(this.pagination.sortBy !== 'time' || this.pagination.sortOrder !== 'asc');
    hasTagFilter = $derived(Boolean(this.pagination.tagIds?.length));
    hasAttendanceModeFilter = $derived(this.pagination.attendanceMode);
    sortFilter = $derived({ sortBy: this.pagination.sortBy, sortOrder: this.pagination.sortOrder });
    hasAnyFilter = $derived(this.hasDateFilter || this.hasLocationFilter || this.hasSearchFilter || this.hasSortFilter || this.hasTagFilter || this.hasOnlineEventsFilter);
    hasFilterBehindButton = $derived(this.hasDateFilter || this.hasAttendanceModeFilter || this.sortFilter.sortBy !== 'time');
    searchFilter = $derived(this.pagination.searchTerm?.trim());
    dateFilter = $derived({ start: this.pagination.startDate, end: this.pagination.endDate });
    locationFilter = $derived({ plzCity: this.pagination.plzCity, lat: this.pagination.lat, lng: this.pagination.lng, distance: this.pagination.distance });

    constructor(initialData?: { events: UiEvent[]; pagination: PaginationState }) {
        if (initialData) {
            this.events = initialData.events;
            this.pagination = initialData.pagination;
        }
        // Bind the loadMoreEvents method to maintain this context when it is used as a callback
        this.loadMoreEvents = this.loadMoreEvents.bind(this);
    }

    // Initialize with server data
    initialize(args: { events: UiEvent[]; pagination: PaginationState }) {
        this.events = args.events;
        this.pagination = args.pagination;
    }

    // Core loading function
    async loadEvents(params: Parameters<typeof fetchEventsWithCookiePersistence>[0], append?: boolean) {
        const applyPagination = (params: Parameters<typeof fetchEventsWithCookiePersistence>[0]) => {
                // Normalize undefined to null for consistency with PaginationState type
                this.pagination = {
                    ...this.pagination,
                    page: params.page ?? this.pagination.page,
                    startDate: params.startDate ?? null,
                    endDate: params.endDate ?? null,
                    plzCity: params.plzCity ?? null,
                    distance: params.distance ?? null,
                    lat: params.lat ?? null,
                    lng: params.lng ?? null,
                    searchTerm: params.searchTerm ?? null,
                    sortBy: params.sortBy ?? null,
                    sortOrder: params.sortOrder ?? null,
                    tagIds: params.tagIds ?? null,
                    attendanceMode: params.attendanceMode ?? null,
                    totalEvents: params.totalEvents ?? null,
                    totalPages: params.totalPages ?? null,
                };
        }

        try {
            this.loadingState = append ? 'loading-more' : 'loading';
            applyPagination(params); // optimistically set pagination state
            const data = await fetchEventsWithCookiePersistence(params);

            if (append) {
                // Filter out duplicate events that may result from pagination
                const existingEventIds = new SvelteSet(this.events.map((event) => event.id));
                const newEvents = data.events.filter((event) => !existingEventIds.has(event.id));
                this.events.push(...newEvents);
            } else {
                this.events = data.events;
            }

            applyPagination(data.pagination);
        } finally {
            this.loadingState = 'not-loading';
            this.finishedLoadingCallbacks.forEach((callback) => callback(append));
        }
    }

    // Load more events for infinite scroll
    async loadMoreEvents() {
        if (this.loadingState !== 'not-loading') return;

        return this.loadEvents(
            {
                page: this.pagination.page + 1,
                limit: this.pagination.limit,
                startDate: this.pagination.startDate,
                endDate: this.pagination.endDate,
                plzCity: this.pagination.plzCity,
                distance: this.pagination.distance,
                lat: this.pagination.lat,
                lng: this.pagination.lng,
                searchTerm: this.pagination.searchTerm,
                sortBy: this.pagination.sortBy,
                sortOrder: this.pagination.sortOrder,
                tagIds: this.pagination.tagIds,
                attendanceMode: this.pagination.attendanceMode
            },
            true
        );
    }

    // Date range change handler
    onDateChange: DateRangePickerOnChange = (value) => {
        this.loadEvents({
            ...this.pagination,
            page: 1,
            limit: this.pagination.limit,
            startDate: value.start?.toString() ?? null,
            endDate: value.end?.toString() ?? null
        });
    };

    // Location/distance change handler
    handleLocationDistanceChange = (event: LocationChangeEvent) => {
        this.loadEvents({
            ...this.pagination,
            page: 1,
            plzCity: event.location,
            lat: event.latitude ?? null,
            lng: event.longitude ?? null,
            distance: event.distance,
        });
    };


    // Sort change handler
    handleSortChanged = (value: string) => {
        const [sortBy, sortOrder] = value.split('_');
        this.loadEvents({
            ...this.pagination,
            page: 1,
            sortBy: sortBy,
            sortOrder: sortOrder
        });
    };

    // Helper function to get sort value
    private getSortValue(sortBy?: string | null, sortOrder?: string | null) {
        const sb = sortBy ?? 'time';
        const so = sortOrder ?? 'asc';
        return `${sb}_${so}`;
    }

    handleSearchTermChange(value: string) {
        this.loadEvents({
            ...this.pagination,
            tagIds: null,
            searchTerm: value,
            page: 1,
        })
    }

    handleAttendanceModeChange(value: AttendanceMode | null) {
        this.loadEvents({
            ...this.pagination,
            attendanceMode: value,
            page: 1,
        })
    }

    // Get event by ID
    getEventById(id: number | null) {
        if (!id) return undefined;
        if (isNaN(id)) return undefined;
        return this.events.find((event) => event.id === id);
    }

    resetFilters() {
        this.hasAnyFilter = false
        this.showTextSearch = false;
        return this.loadEvents(initialPagination());
    }

    // Refresh current page
    async refresh() {
        return this.loadEvents({
            ...this.pagination,
            page: 1
        });
    }

    /**
     * Register a callback to be invoked when loading finishes.
     * @example
     * const unsubscribe = eventsStore.onFinishedLoading(() => console.log('done!'));
     * // later: unsubscribe();
     */
    onFinishedLoading(callback: FinishedLoadingCallback) {
        this.finishedLoadingCallbacks.add(callback);
        return () => this.finishedLoadingCallbacks.delete(callback);
    }
}

// Create a new store instance for each server request, or use singleton on client
function createEventsStore(): EventsStore {
    if (browser) {
        // Client-side: use singleton to maintain state across navigation
        return globalThis.__eventsStore ?? (globalThis.__eventsStore = new EventsStore());
    } else {
        // Server-side: always create fresh instance to avoid state pollution
        return new EventsStore();
    }
}

export const eventsStore = createEventsStore();

// Type augmentation for the global store
declare global {
    var __eventsStore: EventsStore | undefined;
}

type FinishedLoadingCallback = (append?: boolean) => void;