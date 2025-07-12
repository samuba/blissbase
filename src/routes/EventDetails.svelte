<script lang="ts">
	import { formatAddress, formatTimeStr } from '$lib/common';
	import PopOver from '$lib/components/PopOver.svelte';
	import AddToCalendarButton from '$lib/components/AddToCalendarButton.svelte';
	import type { UiEvent } from '$lib/server/events';
	import RandomPlaceholderImg from '$lib/components/RandomPlaceholderImg.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';

	let { event, onShowEventForTag }: { event: UiEvent; onShowEventForTag: (tag: string) => void } =
		$props();

	let showOriginal = $state(false);
	let showFullscreenImage = $state(false);

	let contactUrl = $derived.by(() => {
		let contact = event.contact;
		if (contact && /^\+?\d[\d\s\-\(\)]+\d$/.test(contact)) {
			contact = `tel:${contact.replace(/\s/g, '')}`;
		}

		if (contact?.startsWith('https://t.me/')) {
			contact = contact.replace('https://t.me/', 'tg://resolve?domain=');
		}
		if (contact?.startsWith('tg://')) {
			contact += `&text=${contactMessage}&parse_mode=HTML`;
		}

		if (contact?.startsWith('mailto:')) {
			contact += `?subject=${encodeURIComponent(`Anmeldung für ${event.name} (${event.startAt.toLocaleDateString('de-DE')})`)}&body=${contactMessage}`;
		}

		return contact;
	});

	let contactMethod: 'Telegram' | 'WhatsApp' | 'Telefon' | 'Email' | undefined = $derived.by(() => {
		if (
			contactUrl?.startsWith('tg://') ||
			contactUrl?.startsWith('t.me/') ||
			contactUrl?.startsWith('https://t.me/')
		) {
			return 'Telegram';
		}
		if (contactUrl?.startsWith('https://wa.me/')) {
			return 'WhatsApp';
		}
		if (contactUrl?.startsWith('tel:')) {
			return 'Telefon';
		}
		if (contactUrl?.startsWith('mailto:')) {
			return 'Email';
		}
	});

	let showQuelleInsteadOfAnmelden = $derived(
		['heilnetz', 'heilnetzowl', 'ggbrandenburg', 'kuschelraum'].includes(event.source)
	);

	function fixTelegramUnsupportedChars(text: string) {
		return text
			.replace(/'/g, '"')
			.replace(/ä/g, 'ae')
			.replace(/ö/g, 'oe')
			.replace(/ü/g, 'ue')
			.replace(/ß/g, 'ss')
			.replace(/Ä/g, 'Ae')
			.replace(/Ö/g, 'Oe')
			.replace(/Ü/g, 'Ue')
			.replace(/[\u{1F300}-\u{1F9FF}]/gu, '') // Remove emojis
			.replace(/[\^\\|]/g, '') // remove special chars known to break in telegram links. These work fine: !@#$%&*()_+-=[]{};":,.<>/?
			.trim();
	}

	const contactMessage = $derived(
		// using tg:// instead of https://t.me/ because t.me does not work properly with special characters like ( ' " etc. tg:// does but does not support umlaute...
		encodeURIComponent(
			fixTelegramUnsupportedChars(
				`Hi, ich möchte am Event '${event.name}' am ${event.startAt.toLocaleDateString('de-DE')} teilnehmen.`
			)
		)
	);

	let imageLoadError = $state(false);
	const imageUrl = $derived(
		imageLoadError
			? (event.imageUrls?.[0]?.split('https:')?.[2] ?? '')
			: (event.imageUrls?.[0] ?? '')
	);
</script>

{#if event}
	{#if imageUrl}
		<div class="bg-cover bg-center" style="background-image: url({imageUrl})">
			<figure class="flex justify-center shadow-sm backdrop-blur-md backdrop-brightness-85">
				<img
					src={imageUrl}
					alt={event.name}
					class="max-h-96 w-fit max-w-full cursor-pointer object-cover transition-opacity hover:opacity-90"
					onclick={() => (showFullscreenImage = true)}
					onerror={() => (imageLoadError = true)}
				/>
			</figure>
		</div>
	{:else}
		<RandomPlaceholderImg seed={event.name} class="h-full max-h-70 " />
	{/if}

	<!-- Fullscreen Image Overlay -->
	{#if showFullscreenImage && imageUrl}
		<div
			class=" animate-in fade-in fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-black/95"
			onclick={() => (showFullscreenImage = false)}
		>
			<img src={imageUrl} alt={event.name} class="max-h-full max-w-full object-contain" />
			<button
				class="btn btn-circle absolute top-4 right-4 shadow-lg"
				aria-label="Close fullscreen image"
			>
				<i class="icon-[ph--x] size-5"></i>
			</button>
		</div>
	{/if}

	<div class="card-body text-base-content/90 w-full space-y-4 md:px-10">
		<h1 class="card-title block w-full text-center text-2xl font-semibold">
			{event.name}

			{#if event.soldOut}
				<span class="badge badge-accent ml-1">Ausgebucht</span>
			{/if}
		</h1>

		<div class=" flex flex-wrap justify-center gap-4">
			<div class="flex items-center">
				<div class="bg-base-200 flex items-center justify-center rounded-l-full py-1.5 pr-2 pl-4">
					<i class="icon-[ph--clock] mr-2 size-6"></i>
					<p class="text-md font-medium">
						{formatTimeStr(event.startAt, event.endAt)}
					</p>
				</div>
				<AddToCalendarButton
					event={{
						title: event.name,
						description: event.description ?? undefined,
						start: event.startAt.toISOString(),
						end: event.endAt?.toISOString(),
						location: event.address?.join(', ')
					}}
				/>
			</div>

			{#if event.price && !event.priceIsHtml}
				<div class="bg-base-200 flex items-center justify-center rounded-full px-4 py-1.5">
					<i class="icon-[ph--money] mr-2 size-6"></i>
					<p class="font-medium">{event.price}</p>
				</div>
			{/if}

			{#if event.address?.length}
				<div class="bg-base-200 flex items-center justify-center rounded-full px-4 py-1.5">
					<i class="icon-[ph--map-pin] mr-1 size-6"></i>
					{#if event.address}
						<p class="font-medium">{formatAddress(event.address)}</p>
					{/if}
				</div>
			{/if}

			<ShareButton title={event.name} url={`https://blissbase.app/${event.slug}`} />

			{#if showQuelleInsteadOfAnmelden}
				<a href={event.sourceUrl} target="_blank" rel="noopener noreferrer" class=" btn">
					Quelle
					<i class="icon-[ph--arrow-square-out] size-5"></i>
				</a>
			{:else if event.sourceUrl}
				<a href={event.sourceUrl} target="_blank" rel="noopener noreferrer" class="btn-primary btn">
					Anmelden
					<i class="icon-[ph--arrow-square-out] size-5"></i>
				</a>
			{:else if event.contact}
				<PopOver contentClass="bg-base-100 p-5 max-w-sm z-30">
					{#snippet trigger()}
						<button class="btn btn-primary"> Anmelden </button>
					{/snippet}
					{#snippet content()}
						<span class="word-wrap">
							Der Veranstalter möchte Anmeldungen per <b> {contactMethod}</b> erhalten.
							{#if contactMethod === 'Telegram'}
								Eventuell musst du
								<a
									href="https://telegram.org"
									target="_blank"
									rel="noopener noreferrer"
									class="underline"
								>
									Telegram Messenger
								</a>
								erst installieren.
							{/if}
						</span>
						<div class="mt-3 flex justify-center">
							{#if contactMethod === 'Telegram'}
								<a
									href={contactUrl}
									target="_blank"
									rel="noopener noreferrer"
									class="btn btn-primary"
								>
									<i class="icon-[ph--telegram-logo] size-5"></i>
									Nachricht senden
								</a>
							{:else if contactMethod === 'WhatsApp'}
								<a
									href={contactUrl}
									target="_blank"
									rel="noopener noreferrer"
									class="btn btn-primary"
								>
									<i class="icon-[ph--whatsapp-logo] size-5"></i>
									Nachricht senden
								</a>
							{:else if contactMethod === 'Telefon'}
								<a
									href={contactUrl}
									target="_blank"
									rel="noopener noreferrer"
									class="btn btn-primary"
								>
									<i class="icon-[ph--phone] size-5"></i>
									Anrufen
								</a>
							{:else if contactMethod === 'Email'}
								<a
									href={contactUrl}
									target="_blank"
									rel="noopener noreferrer"
									class="link flex w-fit items-center gap-2 text-lg"
								>
									<i class="icon-[ph--envelope] size-6"></i>
									{contactUrl?.replace('mailto:', '').split('?')[0]}
								</a>
							{/if}
						</div>
					{/snippet}
				</PopOver>
			{/if}
		</div>

		{#if event.description}
			<div class="event-description prose max-w-none">
				{@html event.description}
			</div>
		{/if}

		{#if event.priceIsHtml}
			<h2 class="font-medo mb-2 text-lg font-semibold">Preise</h2>
			<div class="prose -mt-4 max-w-none">
				{@html event.price}
			</div>
		{/if}

		{#if showOriginal}
			<div class="flex w-full items-center gap-2">
				<h2 class="font-medium">Original Message</h2>
				<hr class="border-base-content flex-1" />
			</div>

			<p class="event-description prose">
				{@html event.descriptionOriginal}
			</p>
		{/if}

		{#if event.host}
			<div
				class="bg-base-200 flex w-fit flex-wrap items-center gap-1.5 rounded-full px-4 py-1.5 font-medium"
			>
				<i class="icon-[ph--user-circle] size-6"></i>
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
				<h2 class="mb-2 text-lg font-semibold">Tags</h2>
				<div class="flex flex-wrap items-center gap-2">
					{#each event.tags as tag}
						<button
							class="badge badge-ghost cursor-pointer"
							type="button"
							onclick={() => onShowEventForTag(tag)}
							title="Filter nach Tag"
						>
							{tag}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		{#if event.descriptionOriginal}
			<div class="flex w-full justify-center gap-6">
				<button class="btn btn-sm" onclick={() => (showOriginal = !showOriginal)}
					>Original Nachricht zeigen</button
				>
			</div>
		{/if}
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

<style>
	:global(.event-description a) {
		text-decoration: underline;
	}
</style>
