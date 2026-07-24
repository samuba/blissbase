<script lang="ts">
	import { isTouchDevice } from '$lib/common';
	import { resetGoogleMapsPlacesLoader } from '$lib/googleMapsLoader';
	import { fade } from 'svelte/transition';
	import { onMount } from 'svelte';
	import type { PlacesAutocompleteController } from './PlacesAutocompleteController.svelte';
	import { ALLOWED_DISTANCE_VALUES } from '$lib/locationFilter';

	export interface LocationChangeEvent {
		location: string | null;
		distance: string | null;
		latitude?: number | null;
		longitude?: number | null;
	}

	export interface LocationDistanceInputProps {
		inputId?: string;
		initialLocation?: string | null;
		initialDistance?: string | null;
		resolvedCityName?: string | null;
		locationBiasLat?: number | null;
		locationBiasLng?: number | null;
		onChange?: (event: LocationChangeEvent) => void;
		disabled?: boolean;
	}

	let {
		inputId = `plzCityInput`,
		initialLocation,
		initialDistance,
		resolvedCityName,
		locationBiasLat,
		locationBiasLng,
		onChange,
		disabled
	}: LocationDistanceInputProps = $props();

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

	async function retryGoogleAutocomplete() {
		resetGoogleMapsPlacesLoader();
		autocomplete = null;
		autocompletePromise = null;
		const controller = await ensureAutocomplete();
		await controller.prepare();
	}

	onMount(() => {
		const timer = setTimeout(prepareAutocomplete, 2000);
		return () => clearTimeout(timer);
	});

	let typedPlzCity = $state(``);
	let selectedDistance = $state(``);
	let usingCurrentLocation = $state(false);
	let plzCityInput = $state<HTMLInputElement | null>(null);
	let joinContainer = $state<HTMLDivElement | null>(null);
	let coordsForFilter = $state<string | null>(null);
	let resolvedLat = $state<number | null>(null);
	let resolvedLng = $state<number | null>(null);
	let isLoadingLocation = $state(false);
	let displayLocationText = $state(``);
	let inputWidth = $state(0);
	let blurCloseTimer: ReturnType<typeof setTimeout> | null = null;

	let inputLocationText = $derived(usingCurrentLocation ? displayLocationText : typedPlzCity);
	let showDistanceInput = $derived(
		initialLocation || typedPlzCity.trim() || usingCurrentLocation || isLoadingLocation
	);
	let smallLocateMeButton = $derived(inputWidth < 220);
	let useGoogleAutocomplete = $derived(
		(autocomplete?.isAvailable ?? false) && !usingCurrentLocation
	);

	const distanceOptions = ALLOWED_DISTANCE_VALUES.map((value) => ({
		value,
		label: `< ${value} km`
	}));

	let lastPropDistance = $state<string | null | undefined>(undefined);

	$effect(() => {
		if (initialDistance === lastPropDistance) return;
		lastPropDistance = initialDistance;
		selectedDistance = initialDistance || ``;
	});

	let lastPropLocation = $state<string | null | undefined>(undefined);

	$effect(() => {
		if (initialLocation === lastPropLocation) return;
		lastPropLocation = initialLocation;

		if (initialLocation?.startsWith(`coords:`)) {
			const parts = initialLocation.substring(`coords:`.length).split(`,`);
			if (parts.length === 2) {
				const lat = parseFloat(parts[0]);
				const lng = parseFloat(parts[1]);
				if (!isNaN(lat) && !isNaN(lng)) {
					usingCurrentLocation = true;
					coordsForFilter = `${lat},${lng}`;
					typedPlzCity = resolvedCityName ?? ``;
					displayLocationText = resolvedCityName ?? `Dein Standort`;
					return;
				}
			}

			return;
		}

		if (initialLocation) {
			usingCurrentLocation = false;
			coordsForFilter = null;
			typedPlzCity = initialLocation;
			displayLocationText = ``;
			resolvedLat = locationBiasLat ?? null;
			resolvedLng = locationBiasLng ?? null;
			return;
		}

		usingCurrentLocation = false;
		coordsForFilter = null;
		resolvedLat = null;
		resolvedLng = null;
		typedPlzCity = ``;
		displayLocationText = ``;
	});

	$effect(() => {
		if (typedPlzCity === `` && !usingCurrentLocation) {
			selectedDistance = ``;
		}
	});

	let dropdownPosition = $state({ top: 0, left: 0, width: 0 });

	function updateDropdownPosition() {
		const anchor = joinContainer ?? plzCityInput;
		if (!anchor) return;
		const rect = anchor.getBoundingClientRect();
		const isMobile = window.matchMedia(`(max-width: 639px)`).matches;

		if (isMobile) {
			const dropdownInset = 16;
			dropdownPosition = {
				top: rect.bottom + 4,
				left: dropdownInset,
				width: window.innerWidth - dropdownInset * 2
			};
			return;
		}

		dropdownPosition = {
			top: rect.bottom + 4,
			left: rect.left,
			width: rect.width
		};
	}

	$effect(() => {
		if (!autocomplete?.isOpen) return;

		updateDropdownPosition();
		const onReposition = () => updateDropdownPosition();
		window.addEventListener(`scroll`, onReposition, true);
		window.addEventListener(`resize`, onReposition);

		return () => {
			window.removeEventListener(`scroll`, onReposition, true);
			window.removeEventListener(`resize`, onReposition);
		};
	});

	function notifyChange() {
		if (!onChange) return;

		let eventData: LocationChangeEvent;

		if (usingCurrentLocation && coordsForFilter) {
			const [latStr, lngStr] = coordsForFilter.split(`,`);
			const latitude = parseFloat(latStr);
			const longitude = parseFloat(lngStr);

			eventData = {
				location: null,
				distance: selectedDistance || null,
				latitude: !isNaN(latitude) ? latitude : null,
				longitude: !isNaN(longitude) ? longitude : null
			};
		} else {
			eventData = {
				location: typedPlzCity || null,
				distance: selectedDistance || null,
				latitude: resolvedLat,
				longitude: resolvedLng
			};
		}

		onChange(eventData);
	}

	function applySelectedPlace(args: {
		displayName: string;
		latitude: number;
		longitude: number;
	}) {
		usingCurrentLocation = false;
		coordsForFilter = null;
		resolvedLat = args.latitude;
		resolvedLng = args.longitude;
		typedPlzCity = args.displayName;
		if (!selectedDistance) selectedDistance = `50`;

		onChange?.({
			location: args.displayName,
			distance: selectedDistance,
			latitude: args.latitude,
			longitude: args.longitude
		});

		autocomplete?.close();
		if (isTouchDevice()) plzCityInput?.blur();
	}

	function handleFilterInputChange() {
		if (autocomplete?.isOpen) return;

		autocomplete?.close();

		if (typedPlzCity && selectedDistance === ``) {
			selectedDistance = `50`;
		}
		notifyChange();

		if (isTouchDevice()) plzCityInput?.blur();
	}

	async function handleSuggestionSelect(suggestionIndex: number) {
		const controller = await ensureAutocomplete();
		const suggestion = controller.suggestions[suggestionIndex];
		if (!suggestion) return;

		const place = await controller.selectSuggestion(suggestion);
		if (!place) return;

		applySelectedPlace({
			displayName: place.displayName || place.formattedAddress,
			latitude: place.latitude,
			longitude: place.longitude
		});
	}

	async function handleUseCurrentLocationClick() {
		if (disabled || isLoadingLocation) return;

		autocomplete?.close();
		isLoadingLocation = true;
		usingCurrentLocation = true;
		typedPlzCity = ``;
		displayLocationText = `Standort wird ermittelt...`;
		coordsForFilter = null;

		try {
			const position = await new Promise<GeolocationPosition>((resolve, reject) => {
				navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 12000 });
			});

			const newCoords = `${position.coords.latitude},${position.coords.longitude}`;
			coordsForFilter = newCoords;
			displayLocationText = `Dein Standort`;
			selectedDistance = `50`;

			notifyChange();
		} catch (error) {
			console.error(`Error getting location:`, error);
			usingCurrentLocation = false;
			coordsForFilter = null;
			displayLocationText = ``;

			alert(
				`Standort konnte nicht abgerufen werden. Bitte überprüfe deine Browsereinstellungen oder gib einen Ort manuell ein.`
			);
		} finally {
			isLoadingLocation = false;
		}
	}

	function handleResetLocationClick() {
		autocomplete?.close();
		usingCurrentLocation = false;
		coordsForFilter = null;
		resolvedLat = null;
		resolvedLng = null;
		typedPlzCity = ``;
		displayLocationText = ``;
		selectedDistance = ``;
		notifyChange();
		plzCityInput?.focus();
	}

	function handleInputChange(value: string) {
		if (usingCurrentLocation) {
			usingCurrentLocation = false;
			coordsForFilter = null;
			displayLocationText = ``;
		}

		resolvedLat = null;
		resolvedLng = null;
		typedPlzCity = value;

		void ensureAutocomplete().then((controller) => {
			controller.scheduleFetch({
				input: value,
				biasLat: locationBiasLat,
				biasLng: locationBiasLng
			});
		});
	}

	function handleInputFocus() {
		cancelBlurClose();
		prepareAutocomplete();
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
			handleFilterInputChange();
		}
	}
</script>

{#snippet googleAutocompleteError(retry: () => void)}
	<div class="flex min-w-0 items-center gap-2" data-testid="google-autocomplete-error">
		<span class="text-error truncate text-xs">
			Google Maps Autocomplete konnte nicht geladen werden.
		</span>
		<button type="button" onclick={retry} class="btn btn-xs text-error shrink-0">
			<i class="icon-[ph--arrow-clockwise] size-4 shrink-0"></i>
			Erneut laden
		</button>
	</div>
{/snippet}

<svelte:boundary
	onerror={(error) => {
		console.error(`Google Maps Autocomplete Fehler:`, error);
	}}
>
	{#if autocomplete?.loadFailed}
		{@render googleAutocompleteError(retryGoogleAutocomplete)}
	{:else}
		<div class="relative flex min-w-0 items-center gap-2.5" data-testid="location-distance-input">
			<div
				bind:this={joinContainer}
				class="form-control join flex min-w-0 grow items-center p-0"
				in:fade={{ duration: 280 }}
			>
				<div class="relative min-w-0 flex-1" bind:clientWidth={inputWidth}>
					<label
						class={[
							`input join-item peer group w-full`,
							usingCurrentLocation && !isLoadingLocation && `active`
						]}
					>
						<div
							class="flex items-center justify-center group-focus-within:hidden md:group-focus-within:flex"
						>
							<i class="icon-[ph--map-pin] text-base-content/50 -mr-0.5 size-5"></i>
						</div>
						<input
							bind:this={plzCityInput}
							type="text"
							id={inputId}
							role="combobox"
							aria-expanded={autocomplete?.isOpen ?? false}
							aria-controls="{inputId}-listbox"
							aria-autocomplete="list"
							aria-activedescendant={autocomplete && autocomplete.highlightedIndex >= 0
								? `${inputId}-option-${autocomplete.highlightedIndex}`
								: undefined}
							placeholder="Stadt / PLZ"
							class={[`w-full`]}
							value={inputLocationText}
							disabled={isLoadingLocation || disabled}
							oninput={(event) => handleInputChange(event.currentTarget.value)}
							onchange={handleFilterInputChange}
							onkeydown={handleInputKeydown}
							onfocus={handleInputFocus}
							onblur={scheduleBlurClose}
							in:fade={{ duration: 280 }}
						/>
					</label>

			{#if autocomplete?.isOpen && useGoogleAutocomplete}
				<ul
					id="{inputId}-listbox"
					role="listbox"
					data-testid="location-suggestions"
					class="bg-base-100 border-base-300 fixed z-200 max-h-64 overflow-y-auto rounded-box border shadow-lg"
					style:top="{dropdownPosition.top}px"
					style:left="{dropdownPosition.left}px"
					style:width="{dropdownPosition.width}px"
					onmousedown={cancelBlurClose}
				>
					{#each autocomplete.suggestions as suggestion, index (suggestion.text)}
						<li
							id="{inputId}-option-{index}"
							role="option"
							aria-selected={autocomplete.highlightedIndex === index}
							class={[
								`cursor-pointer px-3 py-2 text-sm border-base-300`,
								autocomplete.highlightedIndex === index && `bg-primary/20`
							]}
							onmouseenter={() => {
								autocomplete.highlightedIndex = index;
							}}
							onmousedown={(event) => {
								event.preventDefault();
								void handleSuggestionSelect(index);
							}}
						>
							{suggestion.text}
						</li>
					{/each}
					<li class="border-base-300 text-base-content/60 border-t px-3 py-1.5 text-xs">
						<span class="flex items-center gap-1">
							<i class="icon-[ph--map-trifold] size-3.5"></i>
							Google Maps
						</span>
					</li>
				</ul>
			{/if}

			<div class="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-1">
				{#if typedPlzCity.trim() && !usingCurrentLocation}
					<button
						type="button"
						data-testid="clear-location-button"
						title="Eingabe löschen"
						class="btn-ghost bg-base-100 text-base-600 flex h-full items-center justify-center px-1"
						onmousedown={(event) => event.preventDefault()}
						onclick={handleResetLocationClick}
					>
						<i class="icon-[ph--x] size-5"></i>
					</button>
				{/if}
				<button
					type="button"
					class={[
						`btn btn-xs mr-0.5 flex h-full items-center justify-center rounded-full py-0.5 peer-focus:hidden`,
						usingCurrentLocation && `bg-base-100`
					]}
					title="Aktuellen Standort verwenden"
					onmousedown={(event) => {
						if (usingCurrentLocation && !isLoadingLocation) event.preventDefault();
					}}
					onclick={usingCurrentLocation && !isLoadingLocation
						? handleResetLocationClick
						: handleUseCurrentLocationClick}
					disabled={isLoadingLocation || disabled}
				>
					{#if isLoadingLocation}
						<i class="icon-[ph--spinner-gap] size-5 animate-spin"></i>
					{:else if usingCurrentLocation}
						<i class="icon-[ph--x] size-4.5"></i>
					{:else}
						<i class="icon-[ph--gps-fix] size-5"></i>
						{#if !typedPlzCity.trim() && !smallLocateMeButton}
							<span class="text-xs"> Standort</span>
						{/if}
					{/if}
				</button>
			</div>
		</div>

		{#if showDistanceInput}
			<select
				id="{inputId}-distance"
				class={[`select join-item w-auto appearance-none`, usingCurrentLocation && `active`]}
				bind:value={selectedDistance}
				onchange={handleFilterInputChange}
				disabled={isLoadingLocation || disabled || (typedPlzCity === `` && !usingCurrentLocation)}
			>
				<option value="">Überall</option>
				{#each distanceOptions as option (option.value)}
					<option value={option.value}>{option.label}</option>
				{/each}
			</select>
		{/if}
			</div>
		</div>
	{/if}

	{#snippet failed(_error, reset)}
		{@render googleAutocompleteError(() => {
			resetGoogleMapsPlacesLoader();
			reset();
		})}
	{/snippet}
</svelte:boundary>
