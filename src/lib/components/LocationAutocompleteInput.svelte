<script lang="ts">
	import type { RemoteFormField } from '@sveltejs/kit';
	import { isTouchDevice } from '$lib/common';
	import { reverseGeocodeCity } from '$lib/rpc/places.remote';
	import { fade } from 'svelte/transition';
	import { onMount } from 'svelte';
	import type { PlacesAutocompleteController } from './PlacesAutocompleteController.svelte';

	export interface LocationAutocompleteChangeEvent {
		locationLabel: string | null;
		latitude: number | null;
		longitude: number | null;
	}

	export interface LocationAutocompleteInputProps {
		inputId?: string;
		initialLabel?: string | null;
		initialLat?: number | null;
		initialLng?: number | null;
		locationLabelField?: RemoteFormField<string>;
		latitudeField?: RemoteFormField<string>;
		longitudeField?: RemoteFormField<string>;
		onChange?: (event: LocationAutocompleteChangeEvent) => void;
		onSelect?: (event: LocationAutocompleteChangeEvent) => void | Promise<void>;
		disabled?: boolean;
	}

	let {
		inputId = `profileLocationInput`,
		initialLabel,
		initialLat,
		initialLng,
		locationLabelField,
		latitudeField,
		longitudeField,
		onChange,
		onSelect,
		disabled,
	}: LocationAutocompleteInputProps = $props();

	let autocomplete = $state<PlacesAutocompleteController | null>(null);
	let autocompletePromise: Promise<PlacesAutocompleteController> | null = null;

	async function ensureAutocomplete() {
		if (autocomplete) return autocomplete;

		if (!autocompletePromise) {
			autocompletePromise = import(`./PlacesAutocompleteController.svelte`).then((module) => {
				const controller = new module.PlacesAutocompleteController();
				autocomplete = controller;
				return controller;
			});
		}

		return autocompletePromise;
	}

	function prepareAutocomplete() {
		void ensureAutocomplete().then((controller) => controller.prepare());
	}

	onMount(() => {
		const timer = setTimeout(prepareAutocomplete, 2000);
		return () => clearTimeout(timer);
	});

	let typedLocation = $state(``);
	let usingCurrentLocation = $state(false);
	let locationInput = $state<HTMLInputElement | null>(null);
	let container = $state<HTMLDivElement | null>(null);
	let resolvedLat = $state<number | null>(null);
	let resolvedLng = $state<number | null>(null);
	let isLoadingLocation = $state(false);
	let selectBusy = $state(false);
	let displayLocationText = $state(``);
	let blurCloseTimer: ReturnType<typeof setTimeout> | null = null;
	let isInputFocused = $state(false);
	let lastInitialLabel = $state<string | null | undefined>(undefined);
	let lastInitialLat = $state<number | null | undefined>(undefined);
	let lastInitialLng = $state<number | null | undefined>(undefined);
	let selectGeneration = 0;
	let selectQueue: Promise<void> = Promise.resolve();
	let confirmedSnapshot: ConfirmedLocationSnapshot = {
		locationLabel: null,
		latitude: null,
		longitude: null,
		usingCurrentLocation: false,
		displayLocationText: ``,
		typedLocation: ``,
	};

	let inputDisabled = $derived(isLoadingLocation || disabled || selectBusy);

	let inputLocationText = $derived(usingCurrentLocation ? displayLocationText : typedLocation);
	let useGoogleAutocomplete = $derived((autocomplete?.isAvailable ?? false) && !usingCurrentLocation);
	let showAutocompletePanel = $derived(
		isInputFocused && (autocomplete?.keepPanelOpen ?? false) && !usingCurrentLocation,
	);
	let showGoogleLoadingHint = $derived(showAutocompletePanel && !autocomplete?.isAvailable);
	let showTypeForSuggestionsHint = $derived(
		showAutocompletePanel &&
			autocomplete?.isAvailable &&
			!autocomplete.isLoading &&
			!autocomplete.hasSearched &&
			typedLocation.trim().length < 2,
	);
	let showNoResultsHint = $derived(
		showAutocompletePanel &&
			autocomplete?.isAvailable &&
			!autocomplete.isLoading &&
			autocomplete.hasSearched &&
			!autocomplete.suggestions.length,
	);

	$effect(() => {
		if (initialLabel === lastInitialLabel && initialLat === lastInitialLat && initialLng === lastInitialLng) return;
		lastInitialLabel = initialLabel;
		lastInitialLat = initialLat;
		lastInitialLng = initialLng;

		if (initialLabel?.trim()) {
			usingCurrentLocation = false;
			typedLocation = initialLabel;
			displayLocationText = ``;
			resolvedLat = initialLat ?? null;
			resolvedLng = initialLng ?? null;
			saveConfirmedSnapshot({
				locationLabel: initialLabel,
				latitude: initialLat ?? null,
				longitude: initialLng ?? null,
			});
			syncFormFields({
				locationLabel: initialLabel,
				latitude: initialLat ?? null,
				longitude: initialLng ?? null,
			});
			return;
		}

		usingCurrentLocation = false;
		typedLocation = ``;
		displayLocationText = ``;
		resolvedLat = null;
		resolvedLng = null;
		saveConfirmedSnapshot({ locationLabel: null, latitude: null, longitude: null });
		syncFormFields({ locationLabel: null, latitude: null, longitude: null });
	});

	let dropdownPosition = $state({ top: 0, left: 0, width: 0 });

	function updateDropdownPosition() {
		if (!container) return;
		const rect = container.getBoundingClientRect();
		const isMobile = window.matchMedia(`(max-width: 639px)`).matches;

		if (isMobile) {
			const dropdownInset = 16;
			dropdownPosition = {
				top: rect.bottom + 4,
				left: dropdownInset,
				width: window.innerWidth - dropdownInset * 2,
			};
			return;
		}

		dropdownPosition = {
			top: rect.bottom + 4,
			left: rect.left,
			width: rect.width,
		};
	}

	$effect(() => {
		if (!showAutocompletePanel) return;

		updateDropdownPosition();
		const onReposition = () => updateDropdownPosition();
		window.addEventListener(`scroll`, onReposition, true);
		window.addEventListener(`resize`, onReposition);

		return () => {
			window.removeEventListener(`scroll`, onReposition, true);
			window.removeEventListener(`resize`, onReposition);
		};
	});

	function syncFormFields(args: LocationAutocompleteChangeEvent) {
		locationLabelField?.set(args.locationLabel ?? ``);
		latitudeField?.set(args.latitude != null ? String(args.latitude) : ``);
		longitudeField?.set(args.longitude != null ? String(args.longitude) : ``);
		onChange?.(args);
	}

	function saveConfirmedSnapshot(args: LocationAutocompleteChangeEvent) {
		confirmedSnapshot = {
			locationLabel: args.locationLabel,
			latitude: args.latitude,
			longitude: args.longitude,
			usingCurrentLocation,
			displayLocationText,
			typedLocation: usingCurrentLocation ? `` : (args.locationLabel ?? ``),
		};
	}

	function revertToConfirmedSnapshot() {
		usingCurrentLocation = confirmedSnapshot.usingCurrentLocation;
		displayLocationText = confirmedSnapshot.displayLocationText;
		typedLocation = confirmedSnapshot.typedLocation;
		resolvedLat = confirmedSnapshot.latitude;
		resolvedLng = confirmedSnapshot.longitude;
		syncFormFields({
			locationLabel: confirmedSnapshot.locationLabel,
			latitude: confirmedSnapshot.latitude,
			longitude: confirmedSnapshot.longitude,
		});
	}

	function notifyChange() {
		syncFormFields({
			locationLabel: typedLocation || null,
			latitude: resolvedLat,
			longitude: resolvedLng,
		});
	}

	async function notifySelect(args: LocationAutocompleteChangeEvent) {
		syncFormFields(args);

		if (!onSelect) {
			saveConfirmedSnapshot(args);
			return;
		}

		const generation = ++selectGeneration;
		selectBusy = true;

		const run = async () => {
			if (generation !== selectGeneration) return;

			try {
				await onSelect(args);
				if (generation !== selectGeneration) return;
				saveConfirmedSnapshot(args);
			} catch (error) {
				if (generation === selectGeneration) revertToConfirmedSnapshot();
				throw error;
			} finally {
				if (generation === selectGeneration) selectBusy = false;
			}
		};

		const queued = selectQueue.then(run, run);
		selectQueue = queued.then(
			() => undefined,
			() => undefined,
		);
		await queued;
	}

	async function applySelectedPlace(args: {
		displayName: string;
		latitude: number;
		longitude: number;
	}) {
		usingCurrentLocation = false;
		resolvedLat = args.latitude;
		resolvedLng = args.longitude;
		typedLocation = args.displayName;

		try {
			await notifySelect({
				locationLabel: args.displayName,
				latitude: args.latitude,
				longitude: args.longitude,
			});
		} catch {
			// onSelect failed — notifySelect already reverted the UI
		}

		autocomplete?.close();
		if (isTouchDevice()) locationInput?.blur();
	}

	function handleInputCommit() {
		if (autocomplete?.isOpen) return;
		autocomplete?.close();
		notifyChange();
		if (isTouchDevice()) locationInput?.blur();
	}

	async function handleSuggestionSelect(suggestionIndex: number) {
		if (inputDisabled) return;

		const controller = await ensureAutocomplete();
		const suggestion = controller.suggestions[suggestionIndex];
		if (!suggestion) return;

		const place = await controller.selectSuggestion(suggestion);
		if (!place) return;
		if (inputDisabled) return;

		await applySelectedPlace({
			displayName: place.displayName || place.formattedAddress,
			latitude: place.latitude,
			longitude: place.longitude,
		});
	}

	async function handleUseCurrentLocationClick() {
		if (inputDisabled) return;

		autocomplete?.close();
		isLoadingLocation = true;
		usingCurrentLocation = true;
		typedLocation = ``;
		displayLocationText = `Standort wird ermittelt...`;

		let latitude: number;
		let longitude: number;
		try {
			const position = await new Promise<GeolocationPosition>((resolve, reject) => {
				navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 12000 });
			});
			latitude = position.coords.latitude;
			longitude = position.coords.longitude;
		} catch (error) {
			console.error(`Error getting location:`, error);
			usingCurrentLocation = false;
			displayLocationText = ``;
			isLoadingLocation = false;
			alert(
				`Standort konnte nicht abgerufen werden. Bitte überprüfe deine Browsereinstellungen oder gib einen Ort manuell ein.`,
			);
			return;
		}

		resolvedLat = latitude;
		resolvedLng = longitude;

		let locationLabel = ``;
		try {
			const cityName = await reverseGeocodeCity({ latitude, longitude });
			if (cityName?.trim()) locationLabel = cityName.trim();
		} catch (error) {
			console.error(`Error reverse geocoding location:`, error);
		} finally {
			isLoadingLocation = false;
		}

		displayLocationText = locationLabel;

		try {
			await notifySelect({
				locationLabel: locationLabel || null,
				latitude,
				longitude,
			});
		} catch {
			// onSelect failed — notifySelect already reverted the UI
		}
	}

	async function handleResetLocationClick() {
		if (inputDisabled) return;

		autocomplete?.close();
		usingCurrentLocation = false;
		resolvedLat = null;
		resolvedLng = null;
		typedLocation = ``;
		displayLocationText = ``;
		try {
			await notifySelect({ locationLabel: null, latitude: null, longitude: null });
		} catch {
			// onSelect failed — notifySelect already reverted the UI
		}
		locationInput?.focus();
	}

	function handleInputChange(value: string) {
		if (usingCurrentLocation) {
			usingCurrentLocation = false;
			displayLocationText = ``;
		}

		resolvedLat = null;
		resolvedLng = null;
		typedLocation = value;
		syncFormFields({
			locationLabel: value.trim() || null,
			latitude: null,
			longitude: null,
		});

		void ensureAutocomplete().then((controller) => {
			if (isInputFocused) controller.openPanel();
			controller.scheduleFetch({
				input: value,
				biasLat: initialLat,
				biasLng: initialLng,
			});
		});
	}

	function handleInputFocus() {
		cancelBlurClose();
		isInputFocused = true;
		prepareAutocomplete();
		void ensureAutocomplete().then((controller) => {
			controller.openPanel();
			controller.scheduleFetch({
				input: typedLocation,
				biasLat: initialLat,
				biasLng: initialLng,
			});
		});
	}

	function cancelBlurClose() {
		if (blurCloseTimer) {
			clearTimeout(blurCloseTimer);
			blurCloseTimer = null;
		}
	}

	function scheduleBlurClose() {
		cancelBlurClose();
		blurCloseTimer = setTimeout(() => {
			isInputFocused = false;
			autocomplete?.close();
		}, 200);
	}

	async function handleInputKeydown(event: KeyboardEvent) {
		const controller = autocomplete ?? (await ensureAutocomplete().catch(() => null));
		if (controller?.isOpen && useGoogleAutocomplete) {
			if (event.key === `ArrowDown`) {
				event.preventDefault();
				controller.moveHighlight(`down`);
				return;
			}

			if (event.key === `ArrowUp`) {
				event.preventDefault();
				controller.moveHighlight(`up`);
				return;
			}

			if (event.key === `Escape`) {
				event.preventDefault();
				controller.close();
				return;
			}

			if (event.key === `Enter`) {
				event.preventDefault();
				const highlighted = controller.getHighlightedSuggestion();
				if (highlighted) {
					await handleSuggestionSelect(controller.highlightedIndex);
					return;
				}
			}

			if (event.key === `Tab`) {
				controller.close();
				return;
			}
		}

		if (event.key === `Enter` && event.currentTarget instanceof HTMLInputElement) {
			const value = event.currentTarget.value.trim();
			if (!value) return;
			handleInputCommit();
		}
	}

	type ConfirmedLocationSnapshot = {
		locationLabel: string | null;
		latitude: number | null;
		longitude: number | null;
		usingCurrentLocation: boolean;
		displayLocationText: string;
		typedLocation: string;
	};
</script>

<div class="relative flex min-w-0 items-center gap-2.5" data-testid="location-autocomplete-input">
	<div bind:this={container} class="relative min-w-0 flex-1">
		<label class="input peer group w-full">
			<div class="flex items-center justify-center group-focus-within:hidden md:group-focus-within:flex">
				<i class="icon-[ph--map-pin] text-base-content/50 -mr-0.5 size-5"></i>
			</div>
			<input
				bind:this={locationInput}
				type="text"
				id={inputId}
				role="combobox"
				aria-expanded={showAutocompletePanel}
				aria-controls="{inputId}-listbox"
				aria-autocomplete="list"
				aria-activedescendant={autocomplete && autocomplete.highlightedIndex >= 0
					? `${inputId}-option-${autocomplete.highlightedIndex}`
					: undefined}
				placeholder="Stadt / PLZ"
				class="w-full"
				value={inputLocationText}
				disabled={inputDisabled}
				oninput={(event) => handleInputChange(event.currentTarget.value)}
				onchange={handleInputCommit}
				onkeydown={handleInputKeydown}
				onfocus={handleInputFocus}
				onblur={scheduleBlurClose}
				in:fade={{ duration: 280 }}
			/>
		</label>

		{#if showAutocompletePanel}
			<ul
				id="{inputId}-listbox"
				role="listbox"
				data-testid="location-suggestions"
				class="bg-base-100 border-base-300 fixed z-[200] max-h-64 overflow-y-auto rounded-box border shadow-lg"
				style:top="{dropdownPosition.top}px"
				style:left="{dropdownPosition.left}px"
				style:width="{dropdownPosition.width}px"
				onmousedown={cancelBlurClose}
			>
				{#if showGoogleLoadingHint}
					<li class="text-base-content/60 flex items-center gap-2 px-3 py-2 text-sm">
						<span class="loading loading-spinner loading-xs"></span>
						Vorschläge werden geladen…
					</li>
				{:else if autocomplete?.isLoading}
					<li class="text-base-content/60 flex items-center gap-2 px-3 py-2 text-sm">
						<span class="loading loading-spinner loading-xs"></span>
						Suche…
					</li>
				{:else if showTypeForSuggestionsHint}
					<li class="text-base-content/60 px-3 py-2 text-sm">Tippen für Vorschläge</li>
				{:else if showNoResultsHint}
					<li class="text-base-content/60 px-3 py-2 text-sm">Ort mit diesem Namen nicht gefunden</li>
				{:else}
					{#each autocomplete?.suggestions ?? [] as suggestion, index (suggestion.text)}
						{@const controller = autocomplete}
						{#if controller}
							<li
								id="{inputId}-option-{index}"
								role="option"
								aria-selected={controller.highlightedIndex === index}
								class={[
									`cursor-pointer px-3 py-2 text-sm border-base-300`,
									controller.highlightedIndex === index && `bg-primary/20`,
								]}
								onmouseenter={() => {
									controller.highlightedIndex = index;
								}}
								onmousedown={(event) => {
									event.preventDefault();
									void handleSuggestionSelect(index);
								}}
							>
								{suggestion.text}
							</li>
						{/if}
					{/each}
				{/if}
				<li class="border-base-300 text-base-content/60 border-t px-3 py-1.5 text-xs">
					<span class="flex items-center gap-1">
						<i class="icon-[ph--map-trifold] size-3.5"></i>
						Google Maps
					</span>
				</li>
			</ul>
		{/if}

		<div class="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-1">
			{#if typedLocation.trim() && !usingCurrentLocation}
				<button
					type="button"
					data-testid="clear-location-button"
					title="Eingabe löschen"
					class="btn-ghost bg-base-100 text-base-600 flex h-full items-center justify-center px-1"
					onclick={handleResetLocationClick}
					disabled={inputDisabled}
				>
					<i class="icon-[ph--x] size-5"></i>
				</button>
			{/if}
			<button
				type="button"
				class="btn btn-xs mr-0.5 flex h-full items-center justify-center rounded-full py-0.5 peer-focus:hidden"
				title="Aktuellen Standort verwenden"
				onclick={usingCurrentLocation && !isLoadingLocation ? handleResetLocationClick : handleUseCurrentLocationClick}
				disabled={inputDisabled}
			>
				{#if isLoadingLocation}
					<i class="icon-[ph--spinner-gap] size-5 animate-spin"></i>
				{:else if usingCurrentLocation}
					<i class="icon-[ph--x] size-4.5"></i>
				{:else}
					<i class="icon-[ph--gps-fix] size-5"></i>
				{/if}
			</button>
		</div>
	</div>

	{#if locationLabelField}
		<input type="hidden" {...locationLabelField.as(`text`)} value={locationLabelField.value() ?? ``} />
	{/if}
	{#if latitudeField}
		<input type="hidden" {...latitudeField.as(`text`)} value={latitudeField.value() ?? ``} />
	{/if}
	{#if longitudeField}
		<input type="hidden" {...longitudeField.as(`text`)} value={longitudeField.value() ?? ``} />
	{/if}
</div>
