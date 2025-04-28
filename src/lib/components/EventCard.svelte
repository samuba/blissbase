<script lang="ts">
	import MapPin from 'phosphor-svelte/lib/MapPin';
	import type { SelectEvent } from '$lib/types';

	const { event, class: className }: { event: SelectEvent; class?: string } = $props();

	let noImage = $state(event.imageUrls?.[0] === undefined);

	console.log(event);

	function formatTimeStr(start: Date | undefined, end: Date | undefined | null): string {
		if (!start) return 'Date TBD';

		const startOptions: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };
		let str = start.toLocaleString('de-DE', startOptions);

		if (end) {
			const endOptionsTimeOnly: Intl.DateTimeFormatOptions = { timeStyle: 'short' };
			const endOptionsDateTime: Intl.DateTimeFormatOptions = {
				dateStyle: 'medium',
				timeStyle: 'short'
			};

			const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
			const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
			const nextDayStart = new Date(startDay.getTime() + 24 * 60 * 60 * 1000);

			// Check if end is on the same day as start OR if end is on the next day and before noon
			const endsOnSameDayOrBeforeNoonNextDay =
				startDay.getTime() === endDay.getTime() ||
				(endDay.getTime() === nextDayStart.getTime() && end.getHours() < 12);

			if (endsOnSameDayOrBeforeNoonNextDay) {
				// Only show end time
				str += ` - ${end.toLocaleTimeString('de-DE', endOptionsTimeOnly)}`;
			} else {
				// Show end date and time
				str += ` - ${end.toLocaleString('de-DE', endOptionsDateTime)}`;
			}
		}
		return str;
	}
</script>

<a href={event.permalink} target="_blank" rel="noopener noreferrer" class="w-full">
	<div
		class="card bg-base-100 flex flex-col rounded-lg shadow-sm transition-all hover:shadow-lg md:flex-row {className}"
	>
		<div
			class={[
				'from-base-200/50 to-base-300 relative  min-w-32 rounded-t-lg bg-gradient-to-br bg-cover bg-center sm:max-w-42 sm:min-w-42 sm:rounded-l-lg sm:rounded-tr-none'
			]}
		>
			{#if noImage}{:else}
				<img
					class="h-full max-h-[90dvw] w-full rounded-t-lg object-cover object-center sm:rounded-l-lg sm:rounded-tr-none"
					src={event.imageUrls?.[0]}
					alt="illustration for event: {event.name}"
					onerror={() => (noImage = true)}
				/>
			{/if}
			<!-- <div
			class="text-muted-foreground absolute right-1 bottom-1 flex items-center justify-center rounded-md rounded-bl-md border-t border-r bg-slate-200 px-1 pt-1 pb-1 text-xs md:right-auto md:left-1"
			title="Event from {event.url.split('/')[2]?.replace('www.', '')}"
		>
			{#if event.url.includes('facebook.com')}
				<IconFacebook class="inline-block size-4" />
			{:else if event.url.includes('meetup.com')}
				<IconMeetup class="inline-block size-4" />
			{:else if event.url.includes('retreat.guru')}
				<IconRetreatGuru class="inline-block size-4" />
			{:else if event.url.includes('.eventbrite.')}
				<IconEventbrite class="inline-block size-4" />
			{/if}
		</div> -->
		</div>

		<div class="card-body flex flex-col gap-2">
			<h3 class="card-title leading-snug tracking-tight">{event.name}</h3>

			<time class="text-muted-foreground text-sm">
				{formatTimeStr(event.startAt, event.endAt)}
			</time>

			{#if event.address?.length}
				<div class="text-muted-foreground flex items-center gap-1 text-sm">
					<MapPin class="mr-1.5 size-4 min-w-4" />
					<span class="leading-tight">
						{event.address.join(' · ')}
					</span>
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
