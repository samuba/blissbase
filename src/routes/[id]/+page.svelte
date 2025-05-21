<script lang="ts">
	import { formatAddress, formatTimeStr } from '$lib/common';
	import CalendarDots from '~icons/ph/calendar-dots';
	import MapPin from '~icons/ph/map-pin';
	import Money from '~icons/ph/money';
	import ArrowLeft from '~icons/ph/arrow-left';
	import Person from '~icons/ph/user-circle';
	let { data } = $props();
	const { event } = $derived(data);

	let registerUrl = $derived(event.sourceUrl ?? event.contact);
</script>

<div class="container mx-auto max-w-2xl sm:p-2">
	{#if event}
		<div class="flex h-14 items-center pl-2">
			<button onclick={() => window.history.back()} class="btn btn-sm">
				<ArrowLeft class="mr-1 size-5" />
				Zurück
			</button>
		</div>
		<div class="card bg-base-100 shadow-xl">
			{#if event.imageUrls && event.imageUrls.length > 0}
				<div
					class="rounded-t-2xl bg-cover bg-center"
					style="background-image: url({event.imageUrls[0]})"
				>
					<figure class="rounded-t-2xl shadow-sm backdrop-blur-md backdrop-brightness-85">
						<img
							src={event.imageUrls[0]}
							alt={event.name}
							class="max-h-96 w-fit max-w-full object-cover"
						/>
					</figure>
				</div>
			{/if}
			<div class="card-body text-base-content/90 items-center text-center">
				<h1 class="card-title mb-4 text-xl font-bold">{event.name}</h1>

				<div class="w-full space-y-4 text-left">
					<div class="flex flex-wrap justify-center gap-4">
						<div class="bg-base-200 flex items-center justify-center rounded-full px-4 py-1.5">
							<CalendarDots class="mr-2 size-6" />
							<p class="text-md font-medium">
								{formatTimeStr(event.startAt, event.endAt)}
							</p>
						</div>

						{#if event.price}
							<div class="bg-base-200 flex items-center justify-center rounded-full px-4 py-1.5">
								<Money class="mr-2 size-6" />
								<p class="font-medium">{event.price}</p>
							</div>
						{/if}

						{#if event.address?.length}
							<div class="bg-base-200 flex items-center justify-center rounded-full px-4 py-1.5">
								<MapPin class="mr-1 size-6" />
								{#if event.address}
									<p class="font-medium">{formatAddress(event.address)}</p>
								{/if}
							</div>
						{/if}

						<a href={registerUrl} target="_blank" rel="noopener noreferrer" class="btn-primary btn">
							Anmelden
						</a>
					</div>

					{#if event.description}
						<p class="event-description whitespace-pre-wrap">
							{@html event.description}
						</p>
					{/if}

					{#if event.host}
						<div class="flex flex-wrap items-center gap-1.5 whitespace-pre-wrap">
							<div class="flex items-center gap-1.5">
								<Person class="size-6" />
								<h2 class="font-medium">Organisation:</h2>
							</div>
							{#if event.hostLink}
								<a
									href={event.hostLink}
									class="underline"
									target="_blank"
									rel="noopener noreferrer"
								>
									{event.host}
								</a>
							{:else}
								{event.host}
							{/if}
						</div>
					{/if}

					{#if event.tags && event.tags.length > 0}
						<div>
							<h2 class="mb-2 font-medium">Tags</h2>
							<div class="flex flex-wrap gap-2">
								{#each event.tags as tag}
									<span class="badge badge-ghost">{tag}</span>
								{/each}
							</div>
						</div>
					{/if}
				</div>

				<div class="card-actions mt-6">
					<a href="/" class="btn btn-sm">
						<ArrowLeft class="mr-1 size-5" />
						Zurück zur Übersicht
					</a>
					{#if event.sourceUrl}
						<a
							href={event.sourceUrl}
							target="_blank"
							rel="noopener noreferrer"
							class="btn btn-secondary">View Source</a
						>
					{/if}
				</div>
			</div>
		</div>
	{:else}
		<div class="py-10 text-center">
			<p class="mb-4 text-2xl font-semibold">Event Not Found</p>
			<p class="text-base-content/70 mb-6">
				The event you are looking for does not exist or may have been moved.
			</p>
			<a href="/" class="btn btn-primary">Go to Homepage</a>
		</div>
	{/if}
</div>

<style>
	.container {
		min-height: calc(100vh - 4rem); /* Assuming navbar height of 4rem */
		display: flex;
		flex-direction: column;
		justify-content: center;
	}

	:global(.event-description a) {
		text-decoration: underline;
	}
</style>
