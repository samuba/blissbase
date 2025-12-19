<script lang="ts">
	import { fade } from 'svelte/transition';
	export interface LocationChangeEvent {
		location: string | null;
		distance: string | null;
		isUsingCurrentLocation: boolean;
		latitude?: number | null;
		longitude?: number | null;
	}

	export interface LocationDistanceInputProps {
		initialLocation?: string | null;
		initialDistance?: string | null;
		resolvedCityName?: string | null;
		onChange?: (event: LocationChangeEvent) => void;
		disabled?: boolean;
	}

	let {
		initialLocation,
		initialDistance,
		resolvedCityName,
		onChange,
		disabled,
	}: LocationDistanceInputProps = $props();

	// Internal state
	let typedPlzCity = $state('');
	let selectedDistance = $state('');
	let usingCurrentLocation = $state(false);
	let plzCityInput = $state<HTMLInputElement | null>(null);
	let coordsForFilter = $state<string | null>(null);
	let isLoadingLocation = $state(false);
	let displayLocationText = $state('');
	let inputWidth = $state(0);

	let showDistanceInput = $derived(
			(initialLocation || typedPlzCity.trim() || usingCurrentLocation || isLoadingLocation)
	);
	let smallLocateMeButton = $derived(inputWidth < 220);

	// Effect to sync component state with props (reacts to prop changes)
	$effect(() => {
		// React to initialLocation changes
		if (initialLocation?.startsWith('coords:')) {
			const parts = initialLocation.substring('coords:'.length).split(',');
			if (parts.length === 2) {
				const lat = parseFloat(parts[0]);
				const lng = parseFloat(parts[1]);
				if (!isNaN(lat) && !isNaN(lng)) {
					usingCurrentLocation = true;
					coordsForFilter = `${lat},${lng}`;
					typedPlzCity = '';
					displayLocationText = 'Dein Standort';
				}
			}
		} else if (initialLocation) {
			// Handle regular initialLocation string
			usingCurrentLocation = false;
			coordsForFilter = null;
			typedPlzCity = initialLocation;
			displayLocationText = '';
		} else {
			// No initialLocation provided
			if (!usingCurrentLocation) {
				typedPlzCity = '';
				displayLocationText = '';
			}
		}
	});

	// Effect to sync distance with props
	$effect(() => {
		selectedDistance = initialDistance || '';
	});

	// Effect to ensure "Überall" is selected when no location is specified
	$effect(() => {
		if (typedPlzCity === '' && !usingCurrentLocation) {
			// If selectedDistance is already '', assigning it again is typically a no-op
			// for Svelte's reactivity if the value hasn't actually changed.
			selectedDistance = '';
		}
	});

	$effect(() => {
		if (!initialLocation && !resolvedCityName) {
			usingCurrentLocation = false;
		}
	});

	const distanceOptions = [
		{ value: '5', label: '< 5 km' },
		{ value: '10', label: '< 10 km' },
		{ value: '15', label: '< 15 km' },
		{ value: '30', label: '< 30 km' },
		{ value: '50', label: '< 50 km' },
		{ value: '100', label: '< 100 km' },
		{ value: '150', label: '< 150 km' },
		{ value: '300', label: '< 300 km' },
		{ value: '500', label: '< 500 km' },
		{ value: '9000', label: '< 9000 km' }
	];

	// Emit changes to the parent component
	function notifyChange() {
		if (!onChange) return;

		let eventData: LocationChangeEvent;

		if (usingCurrentLocation && coordsForFilter) {
			const [latStr, lngStr] = coordsForFilter.split(',');
			const latitude = parseFloat(latStr);
			const longitude = parseFloat(lngStr);

			eventData = {
				location: null,
				distance: selectedDistance || null,
				isUsingCurrentLocation: true,
				latitude: !isNaN(latitude) ? latitude : null,
				longitude: !isNaN(longitude) ? longitude : null,
			};
		} else {
			eventData = {
				location: typedPlzCity || null,
				distance: selectedDistance || null,
				isUsingCurrentLocation: false,
				latitude: null,
				longitude: null,
			};
		}

		onChange(eventData);
	}

	function handleFilterInputChange() {
		if (typedPlzCity && selectedDistance === '') {
			selectedDistance = '50';
		}
		notifyChange();
	}

	async function handleUseCurrentLocationClick() {
		if (disabled || isLoadingLocation) return;

		isLoadingLocation = true;
		usingCurrentLocation = true;
		typedPlzCity = '';
		displayLocationText = 'Standort wird ermittelt...';
		coordsForFilter = null;

		try {
			const position = await new Promise<GeolocationPosition>((resolve, reject) => {
				navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 12000 });
			});

			const newCoords = `${position.coords.latitude},${position.coords.longitude}`;
			coordsForFilter = newCoords;
			displayLocationText = 'Dein Standort';
			selectedDistance = distanceOptions[5].value;

			notifyChange();
		} catch (error) {
			console.error('Error getting location:', error);
			usingCurrentLocation = false;
			coordsForFilter = null;
			displayLocationText = '';

			alert(
				'Standort konnte nicht abgerufen werden. Bitte überprüfe deine Browsereinstellungen oder gib einen Ort manuell ein.'
			);
		} finally {
			isLoadingLocation = false;
		}
	}

	function handleResetLocationClick() {
		usingCurrentLocation = false;
		coordsForFilter = null;
		typedPlzCity = '';
		displayLocationText = '';
		selectedDistance = '';
		notifyChange();
	}
</script>

<div class="flex min-w-0 items-center gap-2.5 overflow-hidden relative">
	<div class="form-control join flex min-w-0 grow items-center overflow-hidden p-0" in:fade={{ duration: 280 }}>
		<div class="relative min-w-0 flex-1 overflow-hidden" bind:clientWidth={inputWidth}>
			{#if usingCurrentLocation && !isLoadingLocation}
				<span
					class="input join-item w-full truncate flex items-center active"
					in:fade={{ duration: 280 }}
				>
					<!-- <i class="icon-[ph--crosshair] -mr-0.5 size-5"></i> -->
					{resolvedCityName || displayLocationText}
				</span>
			{:else}
				<input
					bind:this={plzCityInput}
					type="text"
					id="plzCityInput"
					placeholder="Stadt / PLZ"
					class="input input-bordered join-item peer w-full"
					bind:value={typedPlzCity}
					disabled={isLoadingLocation || disabled}
					oninput={() => {
						if (usingCurrentLocation) {
							usingCurrentLocation = false;
							coordsForFilter = null;
							displayLocationText = '';
						}
					}}
					onchange={handleFilterInputChange}
					in:fade={{ duration: 280 }}
				/>
			{/if}
			<div
				class="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-1"
			>
				{#if typedPlzCity.trim()}
					<button
						title="Eingabe löschen"
						class="btn-ghost bg-base-100 text-base-600 flex h-full  items-center justify-center px-1" onclick={() => {
							typedPlzCity = '';
							notifyChange();
						}}>
						<i class="icon-[ph--x] size-5"></i>
					</button>
				{/if}
				<button
					class={[
							'btn btn-xs flex h-full  items-center justify-center rounded-full py-0.5 peer-focus:hidden mr-0.5',
							usingCurrentLocation && 'bg-base-100'
					]}
					title="Aktuellen Standort verwenden"
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
				id="distance"
				class={["select join-item w-auto z-60 appearance-none", usingCurrentLocation && 'active']} 
				bind:value={selectedDistance}
				onchange={handleFilterInputChange}
				disabled={isLoadingLocation || disabled || (typedPlzCity === '' && !usingCurrentLocation)}
			>
				<option value="">Überall</option>
				{#each distanceOptions as option}
					<option value={option.value}>{option.label}</option>
				{/each}
			</select>
		{/if}
	</div>
</div>

{#snippet filteredIndicator()}
	<div
		class="bg-primary border-base-100 absolute top-0 right-1 h-3 w-3 rounded-full border-2"
	></div>
{/snippet}
