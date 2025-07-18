<script lang="ts">
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
		disabled
	}: LocationDistanceInputProps = $props();

	// Internal state
	let typedPlzCity = $state('');
	let selectedDistance = $state('');
	let usingCurrentLocation = $state(false);
	let plzCityInput = $state<HTMLInputElement | null>(null);
	let coordsForFilter = $state<string | null>(null);
	let isLoadingLocation = $state(false);
	let displayLocationText = $state('');

	// Effect to initialize component state from props
	$effect(() => {
		async function initializeLocationState() {
			// // First, check for existing geolocation permission if no initial location/distance is provided
			// if (!initialLocation && !initialDistance) {
			// 	try {
			// 		const permissionStatus = await navigator.permissions.query({ name: 'geolocation' });
			// 		if (permissionStatus.state === 'granted') {
			// 			// If permission is granted, and no initial location is set, use current location.
			// 			// We also ensure `usingCurrentLocation` isn't already true from a 'coords:' initialLocation.
			// 			if (!usingCurrentLocation) {
			// 				handleUseCurrentLocationClick(); // This function now handles its own state updates.
			// 				return; // Exit early as location is being fetched.
			// 			}
			// 		}
			// 	} catch (error) {
			// 		console.warn('Could not query geolocation permission:', error);
			// 		// Proceed to manual/prop initialization if permission query fails
			// 	}
			// }

			// Existing logic for initializing from props
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
					} else {
						// Invalid coords, reset initialLocation
						initialLocation = null;
					}
				} else {
					// Invalid coords format, reset initialLocation
					initialLocation = null;
				}
			} else if (initialLocation) {
				// Handle regular initialLocation string
				usingCurrentLocation = false;
				coordsForFilter = null;
				typedPlzCity = initialLocation;
				displayLocationText = ''; // No special display text for typed locations
			} else {
				// No initialLocation provided, ensure fields are clear if not using current location (which would be handled above)
				if (!usingCurrentLocation) {
					typedPlzCity = '';
					displayLocationText = '';
				}
			}

			selectedDistance = initialDistance || '';
		}

		initializeLocationState(); // Call the async function to set up the component state.
	});

	// Effect to ensure "Überall" is selected when no location is specified
	$effect(() => {
		if (typedPlzCity === '' && !usingCurrentLocation) {
			// If selectedDistance is already '', assigning it again is typically a no-op
			// for Svelte's reactivity if the value hasn't actually changed.
			selectedDistance = '';
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
		{ value: '400', label: '< 400 km' }
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
				longitude: !isNaN(longitude) ? longitude : null
			};
		} else {
			eventData = {
				location: typedPlzCity || null,
				distance: selectedDistance || null,
				isUsingCurrentLocation: false,
				latitude: null,
				longitude: null
			};
		}

		onChange(eventData);
	}

	function handleFilterInputChange() {
		if (typedPlzCity && selectedDistance === '') {
			selectedDistance = '100';
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
				navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
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

<div class="form-control join flex w-full items-center p-0">
	<div class="relative flex-1">
		{#if usingCurrentLocation && !isLoadingLocation}
			<span
				class="input input-bordered join-item bg-base-200 text-base-content/50 w-full border-r-0"
			>
				<i class="icon-[ph--map-pin] -mr-0.5 size-4"></i>
				{resolvedCityName || displayLocationText}
			</span>
		{:else}
			<input
				bind:this={plzCityInput}
				type="text"
				id="plzCityInput"
				placeholder="Stadt / PLZ"
				class="input input-bordered join-item peer w-full border-r-0"
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
			/>
		{/if}
		<div class="absolute top-1/2 right-1 -translate-y-1/2">
			<button
				class={[
					'btn btn-xs flex h-full w-full items-center justify-center rounded py-0.5 peer-focus:hidden',
					usingCurrentLocation && 'hover:bg-base-300'
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
					<i class="icon-[ph--x] size-5"></i>
				{:else}
					<i class="icon-[ph--crosshair] size-5"></i>
					<span class="text-xs"> Standort</span>
				{/if}
			</button>
		</div>
	</div>
	<select
		id="distance"
		class="select join-item w-auto"
		bind:value={selectedDistance}
		onchange={handleFilterInputChange}
		disabled={isLoadingLocation || disabled || (typedPlzCity === '' && !usingCurrentLocation)}
	>
		<option value="">Überall</option>
		{#each distanceOptions as option}
			<option value={option.value}>{option.label}</option>
		{/each}
	</select>
</div>
