<script lang="ts">
	import Crosshair from '~icons/ph/crosshair';
	import SpinnerBall from '~icons/ph/spinner-ball';
	import X from '~icons/ph/x';

	export interface LocationChangeEvent {
		location: string | null;
		distance: string | null;
		isUsingCurrentLocation: boolean;
	}

	export interface LocationDistanceInputProps {
		initialLocation?: string | null;
		initialDistance?: string | null;
		onChange?: (event: LocationChangeEvent) => void;
		disabled?: boolean;
	}

	// Component props
	let props: LocationDistanceInputProps = $props();
	let initialLocation = props.initialLocation ?? null;
	let initialDistance = props.initialDistance ?? null;
	let onChange = props.onChange;
	let disabled = props.disabled ?? false;

	// Internal state
	let typedPlzCity = $state('');
	let selectedDistance = $state('');
	let usingCurrentLocation = $state(false);
	let coordsForFilter = $state<string | null>(null);
	let isLoadingLocation = $state(false);
	let displayLocationText = $state('');

	// Effect to initialize component state from props
	$effect(() => {
		if (initialLocation?.startsWith('coords:')) {
			usingCurrentLocation = true;
			coordsForFilter = initialLocation;
			typedPlzCity = '';
			displayLocationText = 'Dein Standort';
		} else if (initialLocation) {
			usingCurrentLocation = false;
			coordsForFilter = null;
			typedPlzCity = initialLocation;
			displayLocationText = '';
		}

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

	// Distance options
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

		const location =
			usingCurrentLocation && coordsForFilter ? coordsForFilter : typedPlzCity || null;

		onChange({
			location,
			distance: selectedDistance || null,
			isUsingCurrentLocation: usingCurrentLocation
		});
	}

	function handleFilterInputChange() {
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

			const newCoords = `coords:${position.coords.latitude},${position.coords.longitude}`;
			coordsForFilter = newCoords;
			displayLocationText = 'Dein Standort';

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
		notifyChange();
	}
</script>

<div class="form-control join w-full">
	{#if usingCurrentLocation && !isLoadingLocation}
		<span
			class="input input-bordered join-item bg-base-200 text-base-content-secondary flex w-full items-center border-r-0"
		>
			{displayLocationText}
		</span>
	{:else}
		<input
			type="text"
			id="plzCityInput"
			placeholder="PLZ oder Stadt"
			class="input input-bordered join-item w-full border-r-0"
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
	<button
		class={[
			'btn btn-ghost join-item border-base-500 border-r-0 border-l p-2.5',
			usingCurrentLocation && 'bg-base-200 hover:bg-base-300'
		]}
		title="Aktuellen Standort verwenden"
		onclick={usingCurrentLocation && !isLoadingLocation
			? handleResetLocationClick
			: handleUseCurrentLocationClick}
		disabled={isLoadingLocation || disabled}
	>
		{#if isLoadingLocation}
			<SpinnerBall class="size-5 animate-spin" />
		{:else if usingCurrentLocation}
			<X class="size-5" />
		{:else}
			<Crosshair class="size-5" />
		{/if}
	</button>
	<select
		id="distance"
		class="select select-bordered join-item w-auto"
		bind:value={selectedDistance}
		onchange={handleFilterInputChange}
		disabled={isLoadingLocation || disabled}
	>
		<option value="">Überall</option>
		{#each distanceOptions as option}
			<option value={option.value}>{option.label}</option>
		{/each}
	</select>
</div>
