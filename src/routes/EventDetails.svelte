<script lang="ts">
	import { formatAddress, formatTimeStr, getLongLocale, getContactMethod } from '$lib/common';
	import PopOver from '$lib/components/PopOver.svelte';
	import AddToCalendarButton from '$lib/components/AddToCalendarButton.svelte';
	import type { UiEvent } from '$lib/server/events';
	import RandomPlaceholderImg from '$lib/components/RandomPlaceholderImg.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import ImageDialog from '$lib/components/ImageDialog.svelte';
	import EventAdminSection from '$lib/components/EventAdminSection.svelte';
	import { getFavoriteEventIds, addFavorite, removeFavorite } from '$lib/rpc/favorites.remote';
	import FavoriteButton from '$lib/components/FavoriteButton.svelte';
	import { localeStore } from '../locales/localeStore.svelte';
	import { WEBSITE_SCRAPER_CONFIG } from '$lib/commonWithScripts';
	import { user } from '$lib/user.svelte';
	import { resolve } from '$app/paths';

	let { event, onShowEventForTag }: { event: UiEvent; onShowEventForTag: (tag: string) => void } =
		$props();

	const isAuthor = $derived(user.id && event.authorId && user.id === event.authorId);

	let showOriginal = $state(false);

	let selectedImageIndex = $state(0);

	const contactMessage = $derived(
		// using tg:// instead of https://t.me/ because t.me does not work properly with special characters like ( ' " etc. tg:// does but does not support umlaute...
		encodeURIComponent(
			fixTelegramUnsupportedChars(
				`Hallo, ich habe deinen Event '${event.name}' am ${event.startAt.toLocaleDateString(getLongLocale(localeStore.locale))} auf Blissbase.app gefunden und möchte gerne teilnehmen.`
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
		event.tags2?.filter((x) => x.locale === localeStore.locale)?.forEach((x) => tags.add(x.name));
		event.tags?.forEach((x) => {
			if (x[localeStore.locale]) tags.add(x[localeStore.locale]);
			else tags.add(x);
		});
		return Array.from(tags);
	});

	const mapsUrl = $derived(event.address?.length ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.address.join(', '))}` : undefined);

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

		if (contact?.startsWith('https://wa.me/')) {
			contact += `?text=${contactMessage}`;
		}

		if (contact?.startsWith('mailto:')) {
			contact += `?subject=${encodeURIComponent(`Anmeldung für ${event.name} (${event.startAt.toLocaleDateString(localeStore.longLocale)})`)}&body=${contactMessage}`;
		} else if (getContactMethod(str) === 'Email') {
			// email without mailto: prefix
			contact = `mailto:${contact}?subject=${encodeURIComponent(`Anmeldung für ${event.name} (${event.startAt.toLocaleDateString(localeStore.longLocale)})`)}&body=${contactMessage}`;
		}

		return contact;
	}

	let showQuelleInsteadOfAnmelden = $derived(
		['heilnetz', 'heilnetzowl', 'ggbrandenburg', 'kuschelraum'].includes(event.source) ||
			event.sourceUrl?.includes('ciglobalcalendar.net')
	);

	let dontShowSource = $derived(['megatix_indonesia', "telegram", "whatsapp", "website-form"].includes(event.source));

	let sourceUrl = $derived.by(() => {
		if (!event.sourceUrl) return undefined;
		if (!event.sourceUrl?.startsWith('http')) return `https://${event.sourceUrl}`;
		return event.sourceUrl;
	});

	const hostNamesToHide = ["todo.today"];
	const shouldShowHost = $derived(event.host && hostNamesToHide.every(x => !event.host?.toLowerCase().includes(x)));

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

		<!-- head -->
		<div class="flex flex-col gap-6">
			<div class="relative">
				<h1 class="card-title block w-full text-center text-2xl font-semibold mb-0">
					{event.name}
				</h1>
			</div>
			
			{#if event.soldOut}
				<div class="flex justify-center -mt-1">
					<span class="badge badge-accent badge-xl">Ausgebucht</span>
				</div>
			{/if}
	
			<section class="flex w-full items-center justify-center">
				<div class="max-w-[400px] grid grid-cols-[2.5rem_1fr] gap-y-6 gap-x-5 place-items-center justify-items-start">
					<AddToCalendarButton
						event={{
							title: event.name,
							description: event.description ?? undefined,
							start: event.startAt.toISOString(),
							end: event.endAt?.toISOString(),
							location: event.address?.join(', ')
						}}
					>
						{#snippet children({ props })}
							<button
								{...props}
								type="button"
								title="Zum Kalender hinzufügen"
								aria-label="Zum Kalender hinzufügen"
								class={[`bg-base-200/60 rounded-lg flex items-center justify-center size-11`,props.class ]}
							>
								<i class="icon-[ph--clock] size-7 inset-0"></i>
							</button>
						{/snippet}
					</AddToCalendarButton>

					<AddToCalendarButton
						event={{
							title: event.name,
							description: event.description ?? undefined,
							start: event.startAt.toISOString(),
							end: event.endAt?.toISOString(),
							location: event.address?.join(', ')
						}}
					>
						{#snippet children({ props })}
							<button
								{...props}
								type="button"
								title="Zum Kalender hinzufügen"
								aria-label="Zum Kalender hinzufügen"
								class={[
									`flex cursor-pointer gap-1.5 hover:underline`,
									props.class
								]}
							>
								<p class="text-md font-medium">
									{formatTimeStr(event.startAt, event.endAt, localeStore.locale)}
								</p>
								<i class="icon-[ph--calendar-plus] size-5"></i>
							</button>
						{/snippet}
					</AddToCalendarButton>
					
					{#if event.attendanceMode === 'online'}
						<div class="bg-base-200/60 rounded-lg flex items-center justify-center size-11">
							<i class="icon-[ph--globe] size-7 shrink-0"></i>
						</div>
						<p class="font-medium">Online</p>
					{:else if event.address?.length}
						<a href={mapsUrl} target="_blank" rel="noopener noreferrer" aria-label="Öffne Karte" class="bg-base-200/60 rounded-lg flex items-center justify-center size-11">
							<i class="icon-[ph--map-pin] size-7 shrink-0"></i>
						</a>
						<a
							href={mapsUrl}
							target="_blank"
							rel="noopener noreferrer"
							class={[ `hover:underline block w-full min-w-0 cursor-pointer text-left font-medium` ]}
						>
							<span class={[ `line-clamp-3 min-w-0 wrap-break-word leading-`]}>
								{formatAddress(event.address)}
								<i class="icon-[ph--arrow-square-out] ml-0.75 inline-block size-4.5 shrink-0 align-middle mb-1" aria-hidden="true"></i>
							</span>
						</a>
					{/if}
	
					{#if event.price && !event.priceIsHtml}
						<div class="bg-base-200/60 rounded-lg flex items-center justify-center size-11">
							<i class="icon-[ph--money] size-7 shrink-0"></i>
						</div>	
						<p class="font-medium">{event.price}</p>
					{/if}
				</div>
			</section>

			<div class="flex w-full flex-wrap justify-center gap-4 pt-1">
				{#if isAuthor}
					<a href={resolve(`/edit/${event.id}`)} class="btn btn-warning">
						<i class="icon-[ph--pencil] mr-1 size-4"></i>
						Bearbeiten
					</a>
				{/if}

				<ShareButton title={event.name} url={`https://blissbase.app/${event.slug}`} />
	
				{#if showQuelleInsteadOfAnmelden}
					<a href={sourceUrl} target="_blank" rel="noopener noreferrer" class="btn">
						Quelle
						<i class="icon-[ph--arrow-square-out] size-5"></i>
					</a>
				{:else if sourceUrl && !sourceUrl.includes("todo.today")}
					<a href={sourceUrl} target="_blank" rel="noopener noreferrer" class="btn-primary btn" title="Für Event anmelden">
						<!-- @wc-context: register-for-event -->
						Für Event anmelden
						<i class="icon-[ph--arrow-square-out] size-5"></i>
					</a>
				{:else if singleContact?.method === 'Website'}
					<a
						href={singleContact.url}
						target="_blank"
						rel="noopener noreferrer"
						class="btn-primary btn"
						title="Für Event anmelden"
					>
						<!-- @wc-context: register-for-event -->
						Für Event anmelden
						<i class="icon-[ph--arrow-square-out] size-5"></i>
					</a>
				{:else if event.contact?.length}
					<PopOver contentClass="bg-base-100 p-5 w-xs z-60">
						{#snippet trigger({ props })}
							<button {...props} class={[`btn btn-primary`, props.class]} title="Für Event anmelden"> 
								<!-- @wc-context: register-for-event -->
								Für Event anmelden
							</button>
						{/snippet}
						{#snippet content()}
							{#if singleContact?.method && singleContact?.url}
								<span class="word-wrap">
									Anmeldung per <b> {singleContact.method}</b>.
								</span>
	
								<div class="mt-3 flex flex-col gap-3 justify-center">
									{@render contactButton(singleContact.method, singleContact.url!)}
								</div>
							{:else if event.contact?.length}
								<span class="word-wrap">
									Anmeldung über diese Kanäle:
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
			</div>
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

		{#if shouldShowHost}
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
					{#each tags as tag (tag)}
						<button
							class="badge badge-ghost"
							type="button"
							title="Filter nach Tag"
							// onclick={() => onShowEventForTag(tag)}
						>
							{tag}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		{#if !dontShowSource && event.sourceUrl}
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
					{WEBSITE_SCRAPER_CONFIG[event.source as keyof typeof WEBSITE_SCRAPER_CONFIG]?.label}
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

	:global(.event-description h3) {
		margin-top: 1rem;
		margin-bottom: 0.8rem;
		font-size: 1.2rem;
	}
</style>
