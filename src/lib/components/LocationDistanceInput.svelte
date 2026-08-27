<script lang="ts">
	import { resetGoogleMapsPlacesLoader } from "$lib/googleMapsLoader";
	import { Popover } from "bits-ui";
	import { onMount, tick } from "svelte";
	import type { PlacesAutocompleteController } from "./PlacesAutocompleteController.svelte";
	import { ALLOWED_DISTANCE_VALUES } from "$lib/locationFilter";

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
		fullWidthWhenOpen?: boolean;
	}

	let {
		inputId = `plzCityInput`,
		initialLocation,
		initialDistance,
		resolvedCityName,
		locationBiasLat,
		locationBiasLng,
		onChange,
		disabled,
		fullWidthWhenOpen = false,
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
	let chipEl = $state<HTMLElement | null>(null);
	let popoverEl = $state<HTMLElement | null>(null);
	let distanceSelectEl = $state<HTMLSelectElement | null>(null);
	let coordsForFilter = $state<string | null>(null);
	let resolvedLat = $state<number | null>(null);
	let resolvedLng = $state<number | null>(null);
	let isLoadingLocation = $state(false);
	let displayLocationText = $state(``);
	let editorOpen = $state(false);
	let closingEditor = false;

	let inputLocationText = $derived(usingCurrentLocation ? displayLocationText : typedPlzCity);
	let showDistanceInput = $derived(Boolean(initialLocation || typedPlzCity.trim() || usingCurrentLocation || isLoadingLocation));
	let useGoogleAutocomplete = $derived((autocomplete?.isAvailable ?? false) && !usingCurrentLocation);
	let hasLocation = $derived(Boolean(inputLocationText.trim()) || usingCurrentLocation);
	let distanceLabel = $derived(selectedDistance ? `${selectedDistance} km Radius` : `Überall`);

	const distanceOptions = ALLOWED_DISTANCE_VALUES.map((value) => ({
		value,
		label: `${value} km radius`,
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
					if (resolvedCityName) displayLocationText = resolvedCityName;
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
				longitude: !isNaN(longitude) ? longitude : null,
			};
		} else {
			eventData = {
				location: typedPlzCity || null,
				distance: selectedDistance || null,
				latitude: resolvedLat,
				longitude: resolvedLng,
			};
		}

		onChange(eventData);
	}

	function applySelectedPlace(args: { displayName: string; latitude: number; longitude: number }) {
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
			longitude: args.longitude,
		});

		autocomplete?.close();
		dismissEditor();
	}

	function handleFilterInputChange() {
		autocomplete?.close();

		if (typedPlzCity && selectedDistance === ``) {
			selectedDistance = `50`;
		}
		notifyChange();
		dismissEditor();
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
			longitude: place.longitude,
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
			selectedDistance = `50`;

			notifyChange();
			dismissEditor();
		} catch (error) {
			console.error(`Error getting location:`, error);
			usingCurrentLocation = false;
			coordsForFilter = null;
			displayLocationText = ``;

			alert(`Standort konnte nicht abgerufen werden. Bitte überprüfe deine Browsereinstellungen oder gib einen Ort manuell ein.`);
		} finally {
			isLoadingLocation = false;
		}
	}

	function handleResetLocationClick() {
		closingEditor = false;
		autocomplete?.close();
		usingCurrentLocation = false;
		coordsForFilter = null;
		resolvedLat = null;
		resolvedLng = null;
		typedPlzCity = ``;
		displayLocationText = ``;
		selectedDistance = ``;
		notifyChange();
		if (editorOpen) plzCityInput?.focus();
	}

	function handleDistanceChange() {
		notifyChange();
		autocomplete?.close();
		dismissEditor();
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
				biasLng: locationBiasLng,
			});
		});
	}

	function handleInputFocus() {
		prepareAutocomplete();
	}

	function dismissEditor() {
		closingEditor = true;
		plzCityInput?.blur();
		editorOpen = false;
		queueMicrotask(() => {
			closingEditor = false;
		});
	}

	function closeEditor() {
		if (closingEditor) return;
		if (typedPlzCity && selectedDistance === ``) selectedDistance = `50`;
		if (typedPlzCity.trim() || usingCurrentLocation) notifyChange();
		autocomplete?.close();
		dismissEditor();
	}

	function handleEditorOpenChange(open: boolean) {
		if (closingEditor) {
			editorOpen = false;
			return;
		}

		if (open && disabled) {
			editorOpen = false;
			return;
		}

		if (open) {
			prepareAutocomplete();
			void tick().then(() => plzCityInput?.focus());
			return;
		}

		closeEditor();
	}

	function handleWindowPointerDown(event: PointerEvent) {
		if (!editorOpen) return;
		const target = event.target;
		if (!(target instanceof Element)) return;
		if (target.closest(`[data-testid="location-editor-popover"]`)) return;
		if (target.closest(`[data-testid="location-suggestions"]`)) return;
		if (chipEl?.contains(target)) return;
		closeEditor();
	}

	function getOpenEditorTabStops() {
		const stops: HTMLElement[] = [];
		if (plzCityInput) stops.push(plzCityInput);

		const select = distanceSelectEl ?? popoverEl?.querySelector<HTMLSelectElement>(`[data-testid="${inputId}-distance"]`);
		if (select && !select.disabled) stops.push(select);

		const gps = popoverEl?.querySelector<HTMLButtonElement>(`[data-testid="use-current-location-button"]`);
		if (gps && !gps.disabled) stops.push(gps);

		return stops;
	}

	function handleEditorTab(event: KeyboardEvent) {
		if (!editorOpen || event.key !== `Tab`) return;

		const stops = getOpenEditorTabStops();
		if (stops.length < 2) return;

		const active = document.activeElement;
		const index = stops.findIndex((el) => el === active);
		if (index === -1) return;

		if (event.shiftKey) {
			if (index === 0) return;
			event.preventDefault();
			event.stopPropagation();
			stops[index - 1].focus();
			return;
		}

		if (index === stops.length - 1) return;
		event.preventDefault();
		event.stopPropagation();
		stops[index + 1].focus();
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (!editorOpen || event.key !== `Tab`) return;
		autocomplete?.close();
		handleEditorTab(event);
	}

	async function confirmEditorFromInput() {
		const controller = autocomplete;
		if (controller?.isOpen && useGoogleAutocomplete) {
			const highlighted = controller.getHighlightedSuggestion();
			if (highlighted) {
				await handleSuggestionSelect(controller.highlightedIndex);
				return;
			}
		}

		const value = (plzCityInput?.value ?? typedPlzCity).trim();
		if (!value) return;
		if (!usingCurrentLocation) typedPlzCity = value;
		handleFilterInputChange();
	}

	async function handleInputKeydown(event: KeyboardEvent) {
		if (event.key === `Enter` && event.currentTarget instanceof HTMLInputElement) {
			event.preventDefault();
			event.stopPropagation();
			void confirmEditorFromInput();
			return;
		}

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
				event.stopPropagation();
				controller.close();
				return;
			}

			if (event.key === `Tab`) {
				controller.close();
			}
		}

		if (event.key === `Escape`) {
			event.preventDefault();
			event.stopPropagation();
			closeEditor();
		}
	}
</script>

<svelte:window onpointerdown={handleWindowPointerDown} onkeydown={handleWindowKeydown} />

{#snippet googleAutocompleteError(retry: () => void)}
	<div class="flex min-w-0 items-center gap-2" data-testid="google-autocomplete-error">
		<span class="text-error truncate text-xs"> Google Maps Autocomplete konnte nicht geladen werden. </span>
		<button type="button" onclick={retry} class="btn btn-xs text-error shrink-0">
			<i class="icon-[ph--arrow-clockwise] size-4 shrink-0"></i>
			Erneut laden
		</button>
	</div>
{/snippet}

{#snippet locateMeButton(classs: string, text: string)}
	<button
		type="button"
		data-testid="use-current-location-button"
		class={[classs, usingCurrentLocation && `btn-active`]}
		title="Aktuellen Standort verwenden"
		onmousedown={(event) => event.preventDefault()}
		onclick={usingCurrentLocation && !isLoadingLocation ? handleResetLocationClick : handleUseCurrentLocationClick}
		disabled={isLoadingLocation || disabled}
	>
		{#if isLoadingLocation}
			<i class="icon-[ph--spinner-gap] size-5 shrink-0 animate-spin"></i>
		{:else if usingCurrentLocation}
			<i class="icon-[ph--x] size-4.5 shrink-0"></i>
		{:else}
			<i class="icon-[ph--gps-fix] size-5 shrink-0"></i>
		{/if}
		{#if text}
			<span>{text}</span>
		{/if}
	</button>
{/snippet}

<svelte:boundary
	onerror={(error) => {
		console.error(`Google Maps Autocomplete Fehler:`, error);
	}}
>
	<div
		class="relative flex min-w-0 flex-col gap-1"
		data-testid="location-distance-input"
		data-autocomplete-status={autocomplete?.loadFailed ? `failed` : autocomplete?.isAvailable ? `ready` : `idle`}
	>
		{#if autocomplete?.loadFailed}
			{@render googleAutocompleteError(retryGoogleAutocomplete)}
		{/if}

		{#if !editorOpen}
			<input type="hidden" data-testid={inputId} value={inputLocationText} />
			{#if showDistanceInput}
				<input type="hidden" data-testid="{inputId}-distance" value={selectedDistance} />
			{/if}
		{/if}

		<Popover.Root bind:open={editorOpen} onOpenChange={handleEditorOpenChange}>
			<div
				bind:this={chipEl}
				class={[
					`w-full min-w-0 items-center gap-1`,
					editorOpen
						? `bg-base-200 border-base-500 rounded-t-box relative z-70 flex h-auto min-h-10 rounded-b-none border-2 border-b-0 shadow-xl [clip-path:inset(-3rem_-3rem_0_-3rem)]`
						: `input h-auto`,
					editorOpen && fullWidthWhenOpen && `max-sm:w-[calc(100vw-2rem)]`,
				]}
			>
				{#if editorOpen}
					<div class="input rounded-t-box -mx-0.5 -mt-0.5 w-[calc(100%+4px)] min-w-0 rounded-b-none">
						<i class="icon-[ph--map-pin] text-base-content/50 -ml-1 size-5 shrink-0"></i>
						<input
							bind:this={plzCityInput}
							type="text"
							id={inputId}
							data-testid={inputId}
							role="combobox"
							aria-expanded={autocomplete?.isOpen ?? false}
							aria-controls="{inputId}-listbox"
							aria-autocomplete="list"
							aria-activedescendant={autocomplete && autocomplete.highlightedIndex >= 0
								? `${inputId}-option-${autocomplete.highlightedIndex}`
								: undefined}
							placeholder="Stadt / PLZ"
							class="w-full min-w-0"
							value={inputLocationText}
							disabled={isLoadingLocation || disabled}
							oninput={(event) => handleInputChange(event.currentTarget.value)}
							onkeydown={handleInputKeydown}
							onfocus={handleInputFocus}
						/>
						{#if hasLocation && !isLoadingLocation}
							<button
								type="button"
								data-testid="clear-location-button"
								title="Eingabe löschen"
								class="btn btn-ghost btn-sm btn-circle -mr-2.5 shrink-0"
								tabindex={-1}
								onmousedown={(event) => event.preventDefault()}
								onclick={handleResetLocationClick}
							>
								<i class="icon-[ph--x] size-4.5"></i>
							</button>
						{/if}
					</div>
				{/if}

				<Popover.Trigger>
					{#snippet child({ props })}
						<button
							{...props}
							type="button"
							data-testid="{inputId}-summary"
							class={[props.class, ` flex h-9 min-w-0 flex-1 flex-row flex-nowrap items-center gap-2 text-left`, editorOpen && `hidden`]}
							tabindex={editorOpen ? -1 : undefined}
							aria-haspopup="dialog"
							{disabled}
						>
							<i class="icon-[ph--map-pin] text-base-content/50 -ml-1 size-5 shrink-0"></i>
							<span class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
								{#if hasLocation}
									<span class="max-w-full min-w-0 shrink-0 truncate text-sm leading-none font-medium" title={inputLocationText}>
										{inputLocationText}
									</span>
									{#if selectedDistance}
										<span class="text-base-content/55 shrink-0 text-xs leading-none whitespace-nowrap">{distanceLabel}</span>
									{/if}
								{:else}
									<span class="text-base-content/50 text-sm">Stadt / PLZ</span>
								{/if}
							</span>
						</button>
					{/snippet}
				</Popover.Trigger>
				{#if !editorOpen}
					{#if hasLocation && !isLoadingLocation}
						<button
							type="button"
							data-testid="clear-location-button"
							title="Eingabe löschen"
							class="btn btn-ghost btn-sm btn-circle -mr-2.5 shrink-0"
							onclick={handleResetLocationClick}
							{disabled}
						>
							<i class="icon-[ph--x] size-4.5"></i>
						</button>
					{:else}
						{@render locateMeButton(`btn btn-sm h-7 px-2 w-auto max-h-none -mr-2`, `Standort`)}
					{/if}
				{/if}
			</div>

			<Popover.Content
				customAnchor={chipEl}
				side="bottom"
				align="start"
				sideOffset={0}
				avoidCollisions={false}
				trapFocus={false}
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					plzCityInput?.focus();
				}}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
				}}
				class={[
					`bg-base-200 border-base-500 rounded-b-box z-60 flex flex-col rounded-t-none border-2 border-t-0 shadow-xl outline-hidden`,
					fullWidthWhenOpen ? `max-sm:w-[calc(100vw-2rem)] sm:w-(--bits-popover-anchor-width)` : `w-(--bits-popover-anchor-width)`,
				]}
			>
				<div bind:this={popoverEl} data-testid="location-editor-popover" class="flex min-w-0 flex-col">
					<div class="flex min-w-0 items-center gap-2 p-2">
						<select
							bind:this={distanceSelectEl}
							id="{inputId}-distance"
							data-testid="{inputId}-distance"
							class="select cursor-default field-sizing-content appearance-auto max-sm:min-w-0 max-sm:flex-1 sm:w-fit! sm:flex-none"
							bind:value={selectedDistance}
							onchange={handleDistanceChange}
							disabled={isLoadingLocation || disabled || !hasLocation}
						>
							<option value="">Überall</option>
							{#each distanceOptions as option (option.value)}
								<option value={option.value}>{option.label}</option>
							{/each}
						</select>

						{@render locateMeButton(`btn w-fit shrink-0 gap-2`, `Standort verwenden`)}
					</div>

					{#if autocomplete?.isOpen && useGoogleAutocomplete}
						<ul
							id="{inputId}-listbox"
							role="listbox"
							data-testid="location-suggestions"
							class="border-base-300 bg-base-100 rounded-b-box max-h-64 overflow-y-auto border-t"
						>
							{#each autocomplete.suggestions as suggestion, index (suggestion.text)}
								<li
									id="{inputId}-option-{index}"
									role="option"
									data-testid="location-option"
									aria-selected={autocomplete.highlightedIndex === index}
									class={[`cursor-pointer px-3 py-2 text-sm`, autocomplete.highlightedIndex === index && `bg-primary/20`]}
									onmouseenter={() => {
										autocomplete.highlightedIndex = index;
									}}
									onpointerdown={(event) => {
										event.preventDefault();
										event.stopPropagation();
									}}
									onmousedown={(event) => {
										event.preventDefault();
									}}
									onkeydown={(event) => {
										if (event.key !== `Enter` && event.key !== ` `) return;
										event.preventDefault();
										void handleSuggestionSelect(index);
									}}
									onclick={() => {
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
				</div>
			</Popover.Content>
		</Popover.Root>
	</div>

	{#snippet failed(_error, reset)}
		{@render googleAutocompleteError(() => {
			resetGoogleMapsPlacesLoader();
			reset();
		})}
	{/snippet}
</svelte:boundary>
