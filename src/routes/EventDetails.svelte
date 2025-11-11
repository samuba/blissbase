<script lang="ts">
	import { formatAddress, formatTimeStr } from '$lib/common';
	import PopOver from '$lib/components/PopOver.svelte';
	import AddToCalendarButton from '$lib/components/AddToCalendarButton.svelte';
	import type { UiEvent } from '$lib/server/events';
	import RandomPlaceholderImg from '$lib/components/RandomPlaceholderImg.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import ImageDialog from '$lib/components/ImageDialog.svelte';
	import EventAdminSection from '$lib/components/EventAdminSection.svelte';
	import { getFavoriteEventIds, addFavorite, removeFavorite } from '$lib/favorites.remote';
	import LoginDialog from '$lib/components/LoginDialog.svelte';
	import FavoriteButton from '$lib/components/FavoriteButton.svelte';

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

	let singleContact = $derived(
		event.contact?.length === 1
			? {
					method: getContactMethod(event.contact?.[0]) as ReturnType<typeof getContactMethod>,
					url: getContactUrl(event.contact?.[0])
				}
			: undefined
	);

	const tags = $derived.by(() => {
		const tags = new Set<string>();
		event.tags2?.filter((x) => x.locale === 'de')?.forEach((x) => tags.add(x.name));
		event.tags?.forEach((x) => {
			if (x.de) tags.add(x.de);
			else tags.add(x);
		});
		return Array.from(tags);
	});

	function getContactMethod(str: string | undefined) {
		if (!str?.trim()) return undefined;
		if (str?.startsWith('tg://') || str?.startsWith('t.me/') || str?.startsWith('https://t.me/')) {
			return 'Telegram';
		}
		if (str?.startsWith('https://wa.me/')) {
			return 'WhatsApp';
		}
		if (str?.startsWith('tel:')) {
			return 'Telefon';
		}
		if (str?.startsWith('mailto:')) {
			return 'Email';
		}
		if (str?.match(/^[\w\.-]+@[\w\.-]+\.\w+$/)) {
			return 'Email';
		}
		if (str?.startsWith('http')) {
			return 'Website';
		}
		return 'Website';
	}

	function getContactUrl(str: string | undefined) {
		let contact = str ?? event.hostLink;
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
		} else if (getContactMethod(str) === 'Email') {
			// email without mailto: prefix
			contact = `mailto:${contact}?subject=${encodeURIComponent(`Anmeldung für ${event.name} (${event.startAt.toLocaleDateString('de-DE')})`)}&body=${contactMessage}`;
		}

		return contact;
	}

	let showQuelleInsteadOfAnmelden = $derived(
		['heilnetz', 'heilnetzowl', 'ggbrandenburg', 'kuschelraum'].includes(event.source) ||
			event.sourceUrl?.includes('ciglobalcalendar.net')
	);

	let dontShowSourceUrl = $derived((event.sourceUrl?.includes('todo.today') ?? false));
	let dontShowSource = $derived(['todotoday'].includes(event.source));

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

	// Get all favorites and check if this event is favorited
	const favoritesQuery = getFavoriteEventIds();
	let favorites = $state<number[]>([]);
	let isFavorite = $derived(favorites.includes(event.id));
	let showLoginDialog = $state(false);

	// Load favorites asynchronously without blocking derived state
	$effect(() => {
		favoritesQuery.then((x) => (favorites = x));
	});

	async function toggleFavorite(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		try {
			if (isFavorite) {
				await removeFavorite(event.id).updates(
					favoritesQuery.withOverride((current) => current.filter((id) => id !== event.id))
				);
			} else {
				await addFavorite(event.id).updates(
					favoritesQuery.withOverride((current) => [...current, event.id])
				);
			}
		} catch (error: unknown) {
			// Handle 401 - show login dialog
			if (error && typeof error === 'object' && 'status' in error && error.status === 401) {
				showLoginDialog = true;
			} else {
				console.error(`Failed to toggle favorite:`, error);
			}
		}
	}
</script>

<LoginDialog bind:open={showLoginDialog} />

<svelte:head>
	{#if event.sourceUrl}
		<link rel="canonical" href={event.sourceUrl} />
	{/if}
</svelte:head>

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
					{@render favoriteButton()}
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
		<RandomPlaceholderImg seed={event.name} class="relative h-full max-h-70">
			{@render favoriteButton()}
		</RandomPlaceholderImg>
	{/if}

	<div class="card-body text-base-content/90 w-full space-y-4 md:px-10">
		<div class="relative">
			<h1 class="card-title block w-full pr-12 text-center text-2xl font-semibold">
				{event.name}

				{#if event.soldOut}
					<span class="badge badge-accent ml-1">Ausgebucht</span>
				{/if}
			</h1>
		</div>

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

			{#if event.attendanceMode === 'online'}
				<div class="bg-base-200 flex items-center justify-center rounded-full px-4 py-1.5">
					<i class="icon-[ph--globe] mr-2 size-6"></i>
					<p class="font-medium">Online</p>
				</div>
			{:else if event.address?.length}
				<a
					href={`https://www.google.com/maps/search/?api=1&query=${event.address.join(',')}`}
					target="_blank"
					rel="noopener noreferrer"
					class="btn flex h-fit max-w-full min-w-0 items-center gap-1.5 py-1.5 leading-tight font-medium break-words"
				>
					<i class="icon-[ph--map-pin] size-6 flex-shrink-0"></i>
					<span class="block min-w-0 break-words">{formatAddress(event.address)}</span>
				</a>
			{/if}

			<ShareButton title={event.name} url={`https://blissbase.app/${event.slug}`} />

			{#if !dontShowSourceUrl}
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
				{:else if singleContact?.method === 'Website'}
					<a
						href={singleContact.url}
						target="_blank"
						rel="noopener noreferrer"
						class="btn-primary btn"
					>
						Anmelden
						<i class="icon-[ph--arrow-square-out] size-5"></i>
					</a>
				{:else}
					<PopOver contentClass="bg-base-100 p-5 w-xs z-30">
						{#snippet trigger()}
							<button class="btn btn-primary"> Anmelden </button>
						{/snippet}
						{#snippet content()}
							{#if singleContact?.url}
								<span class="word-wrap">
									Der Veranstalter möchte Anmeldungen per <b> {singleContact.method}</b> erhalten.
								</span>

								<div class="mt-3 flex justify-center">
									{@render contactButton(singleContact.method, singleContact.url!)}
								</div>
							{:else}
								<span class="word-wrap">
									Der Veranstalter möchte Anmeldungen über diese Kanäle erhalten:
								</span>
								<div class="mt-3 flex flex-col gap-3">
									{#each event.contact as contact}
										{@render contactButton(getContactMethod(contact), getContactUrl(contact)!)}
									{/each}
								</div>
							{/if}
						{/snippet}
					</PopOver>
				{/if}
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

		{#if tags.length}
			<div>
				<h2 class="mb-2 text-lg font-semibold">Tags</h2>
				<div class="flex flex-wrap items-center gap-2">
					{#each tags as tag}
						<button
							class="badge badge-ghost cursor-pointer hover:underline"
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

		{#if event.source !== 'telegram' && !dontShowSource}
			<div
				class="bg-base-200 flex w-fit flex-wrap items-center gap-1.5 rounded-full px-4 py-1.5 font-medium"
			>
				Quelle:
				<a
					href={event.sourceUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="cursor-pointer underline"
				>
					{event.source.charAt(0).toUpperCase() + event.source.slice(1)}
				</a>
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

{#snippet contactButton(method: ReturnType<typeof getContactMethod>, url: string)}
	{#if method === 'Telegram'}
		<button type="button" onclick={() => openLink(url)} class="btn btn-primary">
			<i class="icon-[ph--telegram-logo] size-5"></i>
			Nachricht senden
		</button>
		<span class="word-wrap">
			Eventuell musst du
			<a href="https://telegram.org" target="_blank" rel="noopener noreferrer" class="underline">
				Telegram Messenger
			</a>
			erst installieren.
		</span>
	{:else if method === 'WhatsApp'}
		<button type="button" onclick={() => openLink(url)} class="btn btn-primary">
			<i class="icon-[ph--whatsapp-logo] size-5"></i>
			Nachricht senden
		</button>
	{:else if method === 'Telefon'}
		<button type="button" onclick={() => openLink(url)} class="btn btn-primary">
			<i class="icon-[ph--phone] size-5"></i>
			Anrufen
		</button>
	{:else if method === 'Email'}
		<button type="button" onclick={() => openLink(url)} class="btn btn-primary">
			<i class="icon-[ph--envelope] size-6"></i>
			Email
		</button>
	{:else if method === 'Website'}
		<a href={url} target="_blank" rel="noopener noreferrer" class="btn btn-primary">
			<i class="icon-[ph--arrow-square-out] size-5"></i>
			Website
		</a>
	{/if}
{/snippet}

{#snippet favoriteButton()}
	<FavoriteButton
		eventId={event.id}
		class="bg-base-100/80 hover:bg-base-100 absolute  right-4 bottom-4  z-5 flex items-center justify-center rounded-full backdrop-blur-sm transition-all hover:scale-110"
	/>
{/snippet}

<style>
	:global(.event-description a) {
		text-decoration: underline;
	}
</style>
