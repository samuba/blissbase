<script lang="ts">
	import { formatAddress, formatTimeStr } from '$lib/common';
	import PopOver from '$lib/components/PopOver.svelte';
	import AddToCalendarButton from '$lib/components/AddToCalendarButton.svelte';
	import type { UiEvent } from '$lib/server/events';
	import RandomPlaceholderImg from '$lib/components/RandomPlaceholderImg.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import ImageDialog from '$lib/components/ImageDialog.svelte';
	import EventAdminSection from '$lib/components/EventAdminSection.svelte';

	let { event, onShowEventForTag }: { event: UiEvent; onShowEventForTag: (tag: string) => void } =
		$props();

	let showOriginal = $state(false);

	let selectedImageIndex = $state(0);

	const contactMessage = $derived(
		// using tg:// instead of https://t.me/ because t.me does not work properly with special characters like ( ' " etc. tg:// does but does not support umlaute...
		encodeURIComponent(
			fixTelegramUnsupportedChars(
				`Hi, ich möchte am Event '${event.name}' am ${event.startAt.toLocaleDateString('de-DE')} teilnehmen.`
			)
		)
	);

	let contactUrl = $derived.by(() => {
		let contact = event.contact ?? event.hostLink;
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

	let contactMethod: 'Telegram' | 'WhatsApp' | 'Telefon' | 'Email' | 'Website' | undefined =
		$derived.by(() => {
			if (!contactUrl) {
				return undefined;
			}
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
			return 'Website';
		});

	let showQuelleInsteadOfAnmelden = $derived(
		['heilnetz', 'heilnetzowl', 'ggbrandenburg', 'kuschelraum'].includes(event.source) ||
			event.sourceUrl?.includes('ciglobalcalendar.net')
	);

	let sourceUrl = $derived.by(() => {
		if (!event.sourceUrl) return undefined;
		if (!event.sourceUrl?.startsWith('http')) return `https://${event.sourceUrl}`;
		return event.sourceUrl;
	});

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

	let imageLoadError = $state(false);
	const imageUrl = $derived.by(() => {
		const rawUrl = event.imageUrls?.[selectedImageIndex] ?? '';
		return imageLoadError ? (rawUrl?.split('https:')?.[2] ?? '') : rawUrl;
	});

	function selectImage(index: number) {
		selectedImageIndex = index;
		imageLoadError = false;
	}

	function openLink(url: string) {
		window.open(url, '_blank', 'noopener,noreferrer');
	}
</script>

{#if event}
	{#if imageUrl}
		<ImageDialog
			imageUrls={event.imageUrls ?? []}
			alt={event.name}
			triggerProps={{ class: 'w-full' }}
			bind:currentIndex={selectedImageIndex}
		>
			<div class="bg-cover bg-center" style="background-image: url({imageUrl})">
				<figure class="flex justify-center shadow-sm backdrop-blur-md backdrop-brightness-85">
					<img
						src={imageUrl}
						alt={event.name}
						class="max-h-96 w-fit max-w-full cursor-pointer object-cover transition-opacity hover:opacity-90"
						onerror={() => (imageLoadError = true)}
					/>
				</figure>
			</div>
		</ImageDialog>

		{#if (event.imageUrls?.length ?? 0) > 1}
			<div class="mt-0.5 flex flex-wrap items-center justify-center gap-2">
				{#each event.imageUrls! as thumbUrl, i}
					<button
						type="button"
						class={[
							'border-base-300 focus:ring-primary cursor-pointer rounded-md transition-all focus:ring-2 focus:outline-none',
							i === selectedImageIndex ? 'ring-primary ring-2' : ''
						]}
						title={`Bild ${i + 1}`}
						onclick={() => selectImage(i)}
					>
						<img
							src={thumbUrl}
							alt={`thumbnail ${i + 1}`}
							class="size-18 rounded-md object-cover"
						/>
					</button>
				{/each}
			</div>
		{/if}
	{:else}
		<RandomPlaceholderImg seed={event.name} class="h-full max-h-70 " />
	{/if}

	<div class="card-body text-base-content/90 w-full space-y-4 md:px-10">
		<h1 class="card-title block w-full text-center text-2xl font-semibold">
			{event.name}

			{#if event.soldOut}
				<span class="badge badge-accent ml-1">Ausgebucht</span>
			{/if}
		</h1>

		<div class="flex w-full flex-wrap justify-center gap-4">
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
				<a
					href={`https://www.google.com/maps/search/?api=1&query=${event.address.join(',')}`}
					target="_blank"
					rel="noopener noreferrer"
					class="btn h-fit max-w-full min-w-0 py-1.5 leading-tight font-medium break-words"
				>
					<i class="icon-[ph--map-pin] mr-1 size-6 flex-shrink-0"></i>
					<span class="block min-w-0 break-words">{formatAddress(event.address)}</span>
				</a>
			{/if}

			<ShareButton title={event.name} url={`https://blissbase.app/${event.slug}`} />

			{#if showQuelleInsteadOfAnmelden}
				<a href={sourceUrl} target="_blank" rel="noopener noreferrer" class=" btn">
					Quelle
					<i class="icon-[ph--arrow-square-out] size-5"></i>
				</a>
			{:else if sourceUrl}
				<a href={sourceUrl} target="_blank" rel="noopener noreferrer" class="btn-primary btn">
					Anmelden
					<i class="icon-[ph--arrow-square-out] size-5"></i>
				</a>
			{:else if contactUrl && contactMethod === 'Website'}
				<a href={contactUrl} target="_blank" rel="noopener noreferrer" class="btn-primary btn">
					Anmelden
					<i class="icon-[ph--arrow-square-out] size-5"></i>
				</a>
			{:else if contactUrl}
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
								<button type="button" onclick={() => openLink(contactUrl)} class="btn btn-primary">
									<i class="icon-[ph--telegram-logo] size-5"></i>
									Nachricht senden
								</button>
							{:else if contactMethod === 'WhatsApp'}
								<button type="button" onclick={() => openLink(contactUrl)} class="btn btn-primary">
									<i class="icon-[ph--whatsapp-logo] size-5"></i>
									Nachricht senden
								</button>
							{:else if contactMethod === 'Telefon'}
								<button type="button" onclick={() => openLink(contactUrl)} class="btn btn-primary">
									<i class="icon-[ph--phone] size-5"></i>
									Anrufen
								</button>
							{:else if contactMethod === 'Email'}
								<button
									type="button"
									onclick={() => openLink(contactUrl)}
									class="link flex w-fit items-center gap-2 text-lg"
								>
									<i class="icon-[ph--envelope] size-6"></i>
									{contactUrl?.replace('mailto:', '').split('?')[0]}
								</button>
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
					<button onclick={() => openLink(event.hostLink!)} class="cursor-pointer underline">
						{event.host}
					</button>
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
							class="badge badge-ghost cursor-pointer hover:underline"
							type="button"
							onclick={() => onShowEventForTag(tag?.en ?? tag)}
							title="Filter nach Tag"
						>
							{tag?.de ?? tag}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		<!-- {#if event.descriptionOriginal}
			<div class="flex w-full justify-center gap-6">
				<button class="btn btn-sm" onclick={() => (showOriginal = !showOriginal)}
					>Original Nachricht zeigen</button
				>
			</div>
		{/if} -->

		<EventAdminSection {event} />
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
