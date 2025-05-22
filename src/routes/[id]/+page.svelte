<script lang="ts">
	import { formatAddress, formatTimeStr } from '$lib/common';
	import CalendarDots from '~icons/ph/calendar-dots';
	import MapPin from '~icons/ph/map-pin';
	import Money from '~icons/ph/money';
	import ArrowLeft from '~icons/ph/arrow-left';
	import Person from '~icons/ph/user-circle';
	import TelegramLogo from '~icons/ph/telegram-logo';
	import WhatsAppLogo from '~icons/ph/whatsapp-logo';
	import ArrowSquareOut from '~icons/ph/arrow-square-out';
	import Phone from '~icons/ph/phone';
	import Envelope from '~icons/ph/envelope';
	import PopOver from '$lib/components/PopOver.svelte';
	let { data } = $props();
	const { event } = $derived(data);

	let contactMethod: 'Telegram' | 'WhatsApp' | 'Telefon' | 'Email' | undefined = $derived.by(() => {
		if (event.contact?.startsWith('https://t.me/')) {
			return 'Telegram';
		}
		if (event.contact?.startsWith('https://wa.me/')) {
			return 'WhatsApp';
		}
		if (event.contact?.startsWith('tel:')) {
			return 'Telefon';
		}
		if (event.contact?.startsWith('mailto:')) {
			return 'Email';
		}
	});
</script>

<div class="container mx-auto max-w-2xl sm:p-2">
	{#if event}
		<div class="flex h-14 items-center pl-2">
			<button onclick={() => window.history.back()} class="btn btn-sm">
				<ArrowLeft class="mr-1 size-5" />
				Zurück
			</button>
		</div>
		<div class="card sm:card-border bg-base-100 rounded-none shadow-xl sm:rounded-2xl">
			{#if event.imageUrls && event.imageUrls.length > 0}
				<div
					class="bg-cover bg-center sm:rounded-t-2xl"
					style="background-image: url({event.imageUrls[0]})"
				>
					<figure class="shadow-sm backdrop-blur-md backdrop-brightness-85 sm:rounded-t-2xl">
						<img
							src={event.imageUrls[0]}
							alt={event.name}
							class="max-h-96 w-fit max-w-full object-cover"
						/>
					</figure>
				</div>
			{/if}
			<div class="card-body text-base-content/90 w-full space-y-4">
				<h1 class="card-title block w-full text-center text-xl font-bold">{event.name}</h1>

				<div class=" flex flex-wrap justify-center gap-4">
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

					{#if event.sourceUrl}
						<a
							href={event.sourceUrl}
							target="_blank"
							rel="noopener noreferrer"
							class="btn-primary btn"
						>
							Anmelden
							<ArrowSquareOut class="size-5" />
						</a>
					{:else if event.contact}
						<PopOver contentClass="bg-base-100 p-4">
							{#snippet trigger()}
								<button class="btn btn-primary"> Anmelden </button>
							{/snippet}
							{#snippet content()}
								<span class="word-wrap">
									Der Veranstalter möchte Anmeldungen per {contactMethod} erhalten.
								</span>
								<div class="mt-3 flex justify-center">
									{#if contactMethod === 'Telegram'}
										<a
											href={event.contact}
											target="_blank"
											rel="noopener noreferrer"
											class="btn btn-primary"
										>
											<TelegramLogo class="size-5" />
											Nachricht senden
										</a>
									{:else if contactMethod === 'WhatsApp'}
										<a
											href={event.contact}
											target="_blank"
											rel="noopener noreferrer"
											class="btn btn-primary"
										>
											<WhatsAppLogo class="size-5" />
											Nachricht senden
										</a>
									{:else if contactMethod === 'Telefon'}
										<a
											href={event.contact}
											target="_blank"
											rel="noopener noreferrer"
											class="btn btn-primary"
										>
											<Phone class="size-5" />
											Anrufen
										</a>
									{:else if contactMethod === 'Email'}
										<a
											href={event.contact}
											target="_blank"
											rel="noopener noreferrer"
											class="btn btn-primary"
										>
											<Envelope class="size-5" />
											Email senden
										</a>
									{/if}
								</div>
							{/snippet}
						</PopOver>
					{/if}
				</div>

				{#if event.description}
					<p class="event-description prose">
						{@html event.description}
					</p>
				{/if}

				{#if event.host}
					<div class=" flex flex-wrap items-center gap-1.5 text-[16px]">
						<div class="flex items-center gap-1.5">
							<Person class="size-6" />
							<h2 class="font-medium">Organisation:</h2>
						</div>
						{#if event.hostLink}
							<a href={event.hostLink} class="underline" target="_blank" rel="noopener noreferrer">
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

				<div class="flex w-full justify-center">
					<a href="/" class="btn btn-sm">
						<ArrowLeft class="mr-1 size-5" />
						Zurück zur Übersicht
					</a>
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
