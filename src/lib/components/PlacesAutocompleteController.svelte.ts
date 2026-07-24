const MIN_INPUT_LENGTH = 2;
const DEBOUNCE_MS = 300;

export type PlaceSuggestion = {
	text: string;
	prediction: google.maps.places.PlacePrediction;
};

export type SelectedPlace = {
	displayName: string;
	formattedAddress: string;
	latitude: number;
	longitude: number;
};

export class PlacesAutocompleteController {
	isLoading = $state(false);
	isAvailable = $state(false);
	loadFailed = $state(false);
	suggestions = $state<PlaceSuggestion[]>([]);
	highlightedIndex = $state(-1);
	isOpen = $state(false);
	keepPanelOpen = $state(false);
	hasSearched = $state(false);

	private sessionToken: google.maps.places.AutocompleteSessionToken | null = null;
	private requestId = 0;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private AutocompleteSuggestion: typeof google.maps.places.AutocompleteSuggestion | null = null;
	private AutocompleteSessionToken: typeof google.maps.places.AutocompleteSessionToken | null = null;
	private initPromise: Promise<void> | null = null;

	private pendingFetch: { input: string; biasLat?: number | null; biasLng?: number | null } | null =
		null;

	prepare() {
		return this.init();
	}

	async init() {
		if (this.isAvailable) return;
		if (this.initPromise) return this.initPromise;

		this.initPromise = this.loadLibrary();
		try {
			await this.initPromise;
		} finally {
			this.initPromise = null;
		}
	}

	private async loadLibrary() {
		this.loadFailed = false;

		const { loadGoogleMapsPlaces } = await import(`$lib/googleMapsLoader`);
		const places = await loadGoogleMapsPlaces();
		if (!places) {
			this.loadFailed = true;
			return;
		}

		this.AutocompleteSuggestion = places.AutocompleteSuggestion;
		this.AutocompleteSessionToken = places.AutocompleteSessionToken;
		this.isAvailable = true;
		this.loadFailed = false;
		this.ensureSessionToken();

		if (this.pendingFetch) {
			const pending = this.pendingFetch;
			this.pendingFetch = null;
			this.scheduleFetch(pending);
		}
	}

	scheduleFetch(args: { input: string; biasLat?: number | null; biasLng?: number | null }) {
		if (!this.isAvailable) {
			this.pendingFetch = args;
			void this.init();
			return;
		}

		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}

		const trimmed = args.input.trim();
		if (trimmed.length < MIN_INPUT_LENGTH) {
			this.requestId++;
			this.hasSearched = false;
			this.suggestions = [];
			this.highlightedIndex = -1;
			this.isLoading = false;
			if (!this.keepPanelOpen) {
				this.close();
			}
			return;
		}

		this.isLoading = true;
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = null;
			void this.fetchSuggestions(args);
		}, DEBOUNCE_MS);
	}

	cancelScheduledFetch() {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
			this.isLoading = false;
		}
	}

	async fetchSuggestions(args: { input: string; biasLat?: number | null; biasLng?: number | null }) {
		if (!this.isAvailable || !this.AutocompleteSuggestion) return;

		const trimmed = args.input.trim();
		if (trimmed.length < MIN_INPUT_LENGTH) {
			this.hasSearched = false;
			this.suggestions = [];
			this.highlightedIndex = -1;
			if (!this.keepPanelOpen) {
				this.close();
			}
			return;
		}

		this.ensureSessionToken();
		const currentRequestId = ++this.requestId;
		this.isLoading = true;
		this.hasSearched = false;

		try {
			const request: google.maps.places.AutocompleteRequest = {
				input: trimmed,
				sessionToken: this.sessionToken ?? undefined
			};

			if (args.biasLat != null && args.biasLng != null) {
				request.locationBias = {
					center: { lat: args.biasLat, lng: args.biasLng },
					radius: 50_000
				};
				request.origin = { lat: args.biasLat, lng: args.biasLng };
			}

			const { suggestions } =
				await this.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);

			if (currentRequestId !== this.requestId) return;

			this.suggestions = suggestions
				.map((suggestion) => suggestion.placePrediction)
				.filter((prediction): prediction is google.maps.places.PlacePrediction => prediction != null)
				.map((prediction) => ({
					text: prediction.text.toString(),
					prediction
				}));

			this.highlightedIndex = this.suggestions.length > 0 ? 0 : -1;
			this.hasSearched = true;
			this.isOpen = this.suggestions.length > 0 || this.keepPanelOpen;
		} catch (error) {
			if (currentRequestId !== this.requestId) return;
			console.error(`Places autocomplete request failed:`, error);
			this.close();
		} finally {
			if (currentRequestId === this.requestId) {
				this.isLoading = this.debounceTimer != null;
			}
		}
	}

	async selectSuggestion(suggestion: PlaceSuggestion): Promise<SelectedPlace | null> {
		try {
			const place = suggestion.prediction.toPlace();
			await place.fetchFields({
				fields: [`displayName`, `formattedAddress`, `location`]
			});

			const location = place.location;
			if (!location) return null;

			const latitude = location.lat();
			const longitude = location.lng();
			const displayName = place.displayName ?? suggestion.text;
			const formattedAddress = place.formattedAddress ?? suggestion.text;

			this.startNewSession();
			this.close();

			return {
				displayName,
				formattedAddress,
				latitude,
				longitude
			};
		} catch (error) {
			console.error(`Failed to fetch place details:`, error);
			return null;
		}
	}

	moveHighlight(direction: `up` | `down`) {
		if (!this.suggestions.length) return;

		if (direction === `down`) {
			this.highlightedIndex =
				this.highlightedIndex < this.suggestions.length - 1 ? this.highlightedIndex + 1 : 0;
			return;
		}

		this.highlightedIndex =
			this.highlightedIndex > 0 ? this.highlightedIndex - 1 : this.suggestions.length - 1;
	}

	getHighlightedSuggestion() {
		if (this.highlightedIndex < 0 || this.highlightedIndex >= this.suggestions.length) return null;
		return this.suggestions[this.highlightedIndex];
	}

	openPanel() {
		this.keepPanelOpen = true;
		this.isOpen = true;
	}

	close() {
		this.cancelScheduledFetch();
		this.keepPanelOpen = false;
		this.isOpen = false;
		this.suggestions = [];
		this.highlightedIndex = -1;
		this.hasSearched = false;
		this.isLoading = false;
		this.requestId++;
	}

	private ensureSessionToken() {
		if (!this.AutocompleteSessionToken) return;
		if (!this.sessionToken) {
			this.sessionToken = new this.AutocompleteSessionToken();
		}
	}

	private startNewSession() {
		if (!this.AutocompleteSessionToken) return;
		this.sessionToken = new this.AutocompleteSessionToken();
	}
}
