<script lang="ts">
	import MapPin from 'phosphor-svelte/lib/MapPin';
	import type { UiEvent } from '$lib/../routes/+page.server';

	const { event, class: className }: { event: UiEvent; class?: string } = $props();

	let noImage = $state(event.imageUrls?.[0] === undefined);

	function formatTimeStr(start: Date | undefined, end: Date | undefined | null): string {
		if (!start) return 'Date TBD';

		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const eventStartDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());

		const diffTime = eventStartDay.getTime() - today.getTime();
		const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

		const rtf = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });

		let dateString: string;

		if (diffDays === 1 || diffDays === 0 || diffDays === -1) {
			const relativeDate = rtf.format(diffDays, 'day');
			// Capitalize first letter for German "Gestern", "Heute", "Morgen"
			dateString = relativeDate.charAt(0).toUpperCase() + relativeDate.slice(1);
		} else {
			dateString = start.toLocaleDateString('de-DE', { dateStyle: 'medium' });
		}

		let str = `${dateString}, ${start.toLocaleTimeString('de-DE', { timeStyle: 'short' })}`;

		if (end) {
			const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
			const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
			const nextDayStart = new Date(startDay.getTime() + 24 * 60 * 60 * 1000);

			// Check if end is on the same day as start OR if end is on the next day and before noon
			const endsOnSameDayOrBeforeNoonNextDay =
				startDay.getTime() === endDay.getTime() ||
				(endDay.getTime() === nextDayStart.getTime() && end.getHours() < 12);

			if (endsOnSameDayOrBeforeNoonNextDay) {
				// Only show end time
				str += ` – ${end.toLocaleTimeString('de-DE', { timeStyle: 'short' })}`;
			} else {
				// Show start date – end date (no times)
				str = dateString; // Initialize str with only the date string, removing the start time
				str += ` – ${end.toLocaleDateString('de-DE', { dateStyle: 'medium' })}`;
			}
		}
		return str;
	}

	function formatAddress(address: string[]): string {
		const bundeslaender = [
			'Bayern',
			'Baden-Württemberg',
			'Berlin',
			'Brandenburg',
			'Bremen',
			'Hamburg',
			'Hessen',
			'Mecklenburg-Vorpommern',
			'Niedersachsen',
			'Nordrhein-Westfalen',
			'Rheinland-Pfalz',
			'Saarland',
			'Sachsen',
			'Sachsen-Anhalt',
			'Schleswig-Holstein',
			'Thüringen'
		];

		const formattedAddress = address
			.filter(
				(x) => !bundeslaender.includes(x.trim()) && !x.trim().match(/\d{5}/) // no zip codes
			)
			.map((x) => {
				return x
					.replace(/Deutschland/g, 'DE')
					.replace(/Österreich/g, 'AT')
					.replace(/Schweiz/g, 'CH');
			});

		return formattedAddress.join(' · ');
	}
</script>

<a href={event.permalink} target="_blank" rel="noopener noreferrer" class="w-full">
	<div
		class="card bg-base-100 flex flex-col rounded-lg shadow-sm transition-all hover:scale-105 hover:shadow-lg sm:flex-row {className}"
	>
		<div
			class={[
				'from-base-200/50 to-base-300 relative min-w-32 rounded-t-lg bg-gradient-to-br bg-cover bg-center sm:max-w-42 sm:min-w-42 sm:overflow-hidden sm:rounded-l-lg sm:rounded-tr-none'
			]}
		>
			{#if noImage}{:else}
				<img
					class="h-full w-full rounded-t-lg object-cover object-center sm:absolute sm:inset-0 sm:rounded-l-lg sm:rounded-tr-none"
					src={event.imageUrls?.[0]}
					alt="illustration for event: {event.name}"
					onerror={() => (noImage = true)}
				/>
			{/if}
		</div>

		<div class="card-body flex flex-col gap-2">
			<h3 class="card-title leading-snug tracking-tight">{event.name}</h3>

			<time class="text-sm">
				{formatTimeStr(event.startAt, event.endAt)}
			</time>

			{#if event.address?.length}
				<div class="flex items-center gap-1 text-sm">
					<MapPin class="mr-1.5 size-4 min-w-4" />

					<div class="leading-tight">
						{#if event.distanceKm}
							<span class="font-medium">
								{event.distanceKm} km entfernt
							</span>
						{/if}
						<div>
							{formatAddress(event.address)}
						</div>
					</div>
				</div>
			{/if}

			{#if event.tags && event.tags.length}
				<div class="mt-1 flex flex-wrap gap-1 text-xs">
					{#each event.tags as tag}
						<span class="badge badge-sm badge-ghost">{tag}</span>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</a>
