<script lang="ts">
	import FormFieldIssues from '$lib/components/FormFieldIssues.svelte';
	import { Dialog } from '$lib/components/dialog';
	import { routes } from '$lib/routes';
	import {
		getAvailableWhatsappChats,
		getWhatsappScrapingTargets,
		saveWhatsappScrapingTarget,
		setWhatsappChatHidden,
	} from '$lib/rpc/adminWhatsapp.remote';
	import { toast } from 'svelte-sonner';

	const targets = $derived(await getWhatsappScrapingTargets());
	const availableChats = $derived(await getAvailableWhatsappChats());
	const defaultFormValues = {
		originalChatJid: ``,
		chatJid: ``,
		name: ``,
		defaultAddress: ``,
		defaultTimezone: `germany`,
		hasOnlyConsciousEvents: false,
	};

	let isAddDialogOpen = $state(false);
	let isEditDialogOpen = $state(false);
	let selectedChatJid = $state<string | null>(null);
	let selectedChatForAdd = $state<{ chatJid: string; name: string } | null>(null);
	let chatFilter = $state(``);
	let chatSourceFilter = $state<ChatSourceFilter>(`groups`);
	let showHiddenChats = $state(false);
	let hidingChatJid = $state<string | null>(null);

	const chatSourceOptions = [
		{ value: `all`, label: `Alle` },
		{ value: `groups`, label: `Gruppen` },
		{ value: `contacts`, label: `Kontakte` },
		{ value: `channels`, label: `Kanäle` },
		{ value: `broadcasts`, label: `Broadcasts` },
		{ value: `other`, label: `Sonstige` },
	] as const;

	const hiddenAvailableChatsCount = $derived(
		availableChats.filter((chat) => chat.hidden).length,
	);

	const filteredAvailableChats = $derived.by(() => {
		const query = chatFilter.trim().toLowerCase();
		return availableChats.filter((chat) => {
			if (!showHiddenChats && chat.hidden) return false;
			if (chatSourceFilter !== `all` && getChatSource(chat.chatJid) !== chatSourceFilter) {
				return false;
			}
			if (!query) return true;
			return (
				chat.name.toLowerCase().includes(query) ||
				chat.chatJid.toLowerCase().includes(query)
			);
		});
	});

	saveWhatsappScrapingTarget.fields.set(defaultFormValues);

	const formProps = saveWhatsappScrapingTarget.enhance(async (form) => {
		const ok = await form.submit().updates(getWhatsappScrapingTargets, getAvailableWhatsappChats);
		if (!ok) return;

		const result = form.result;
		const name = result?.name;
		if (result?.action === `updated`) {
			toast.success(name ? `Target „${name}“ aktualisiert` : `Target aktualisiert`);
			onEditDialogOpenChange(false);
			return;
		}

		toast.success(name ? `Target „${name}“ hinzugefügt` : `Target hinzugefügt`);
		closeAddDialog();
	});

	const sortColumns: { key: SortKey; label: string }[] = [
		{ key: `name`, label: `Name` },
		{ key: `chatJid`, label: `chatJid` },
		{ key: `defaultAddress`, label: `Adresse` },
		{ key: `defaultTimezone`, label: `Timezone` },
		{ key: `hasOnlyConsciousEvents`, label: `Conscious only` },
		{ key: `scrapedEvents`, label: `Events` },
		{ key: `lastRunFinishedAt`, label: `Letzter Lauf` },
		{ key: `lastError`, label: `Fehler` },
	];

	let sortKey = $state<SortKey>(`name`);
	let sortDir = $state<`asc` | `desc`>(`asc`);
	let tableScrollEl = $state<HTMLDivElement | null>(null);
	let stickyScrollEl = $state<HTMLDivElement | null>(null);
	let tableScrollWidth = $state(0);
	let syncingScroll = false;

	const sortedTargets = $derived.by(() => {
		const dir = sortDir === `asc` ? 1 : -1;
		return [...targets].sort((a, b) => compareTargets({ a, b, key: sortKey }) * dir);
	});

	function openAddDialog() {
		selectedChatForAdd = null;
		chatFilter = ``;
		chatSourceFilter = `groups`;
		showHiddenChats = false;
		hidingChatJid = null;
		saveWhatsappScrapingTarget.fields.set(defaultFormValues);
		isAddDialogOpen = true;
	}

	function closeAddDialog() {
		isAddDialogOpen = false;
		selectedChatForAdd = null;
		chatFilter = ``;
		chatSourceFilter = `groups`;
		showHiddenChats = false;
		hidingChatJid = null;
		saveWhatsappScrapingTarget.fields.set(defaultFormValues);
	}

	async function toggleChatHidden(args: { chat: AvailableChat; event: MouseEvent }) {
		args.event.stopPropagation();
		if (hidingChatJid) return;

		const nextHidden = !args.chat.hidden;
		hidingChatJid = args.chat.chatJid;
		try {
			await setWhatsappChatHidden({ chatJid: args.chat.chatJid, hidden: nextHidden });
			await getAvailableWhatsappChats().refresh();
			toast.success(
				nextHidden
					? `„${args.chat.name}“ ausgeblendet`
					: `„${args.chat.name}“ wieder eingeblendet`,
			);
		} catch (error) {
			console.error(`Failed to toggle chat hidden:`, error);
			toast.error(
				nextHidden
					? `Chat konnte nicht ausgeblendet werden`
					: `Chat konnte nicht eingeblendet werden`,
			);
		} finally {
			hidingChatJid = null;
		}
	}

	function getChatSource(chatJid: string): Exclude<ChatSourceFilter, `all`> {
		const jid = chatJid.toLowerCase();
		if (jid.endsWith(`@g.us`)) return `groups`;
		if (jid.endsWith(`@newsletter`)) return `channels`;
		if (jid.endsWith(`@broadcast`)) return `broadcasts`;
		if (
			jid.endsWith(`@s.whatsapp.net`) ||
			jid.endsWith(`@c.us`) ||
			jid.endsWith(`@lid`)
		) {
			return `contacts`;
		}
		return `other`;
	}

	function onAddDialogOpenChange(open: boolean) {
		if (open) {
			isAddDialogOpen = true;
			return;
		}
		closeAddDialog();
	}

	function selectChatForAdd(chat: AvailableChat) {
		selectedChatForAdd = { chatJid: chat.chatJid, name: chat.name };
		saveWhatsappScrapingTarget.fields.set({
			...defaultFormValues,
			chatJid: chat.chatJid,
			name: chat.name,
		});
	}

	function clearSelectedChatForAdd() {
		selectedChatForAdd = null;
		saveWhatsappScrapingTarget.fields.set(defaultFormValues);
	}

	function selectTarget(target: Target) {
		selectedChatJid = target.chatJid;
		saveWhatsappScrapingTarget.fields.set({
			originalChatJid: target.chatJid,
			chatJid: target.chatJid,
			name: target.name ?? ``,
			defaultAddress: target.defaultAddress?.join(`\n`) ?? ``,
			defaultTimezone: target.defaultTimezone,
			hasOnlyConsciousEvents: target.hasOnlyConsciousEvents,
		});
		isEditDialogOpen = true;
	}

	function onEditDialogOpenChange(open: boolean) {
		isEditDialogOpen = open;
		if (open) return;
		selectedChatJid = null;
		saveWhatsappScrapingTarget.fields.set(defaultFormValues);
	}

	function formatAddress(address: string[] | null | undefined) {
		if (!address?.length) return `—`;
		return address.join(`, `);
	}

	function formatDate(value: Date | string | null | undefined) {
		if (!value) return `—`;
		const date = value instanceof Date ? value : new Date(value);
		if (Number.isNaN(date.getTime())) return `—`;
		return date.toLocaleString(`de-DE`);
	}

	function whatsappDirectChatUrl(chatJid: string) {
		const match = chatJid.trim().match(/^(\d+)@s\.whatsapp\.net$/i);
		if (!match) return null;
		return `https://wa.me/${match[1]}`;
	}

	async function copyChatJid(args: { chatJid: string; event: MouseEvent }) {
		args.event.stopPropagation();
		try {
			await navigator.clipboard.writeText(args.chatJid);
			toast.success(`chatJid kopiert`);
		} catch (error) {
			console.error(`Failed to copy chatJid:`, error);
			toast.error(`chatJid konnte nicht kopiert werden`);
		}
	}

	function toggleSort(key: SortKey) {
		if (sortKey === key) {
			sortDir = sortDir === `asc` ? `desc` : `asc`;
			return;
		}
		sortKey = key;
		sortDir = `asc`;
	}

	function sortIcon(key: SortKey) {
		if (sortKey !== key) return `icon-[ph--caret-up-down]`;
		return sortDir === `asc` ? `icon-[ph--caret-up]` : `icon-[ph--caret-down]`;
	}

	function compareTargets(args: { a: Target; b: Target; key: SortKey }) {
		const { a, b, key } = args;
		const left = sortValue({ target: a, key });
		const right = sortValue({ target: b, key });

		if (left == null && right == null) return 0;
		if (left == null) return 1;
		if (right == null) return -1;

		if (typeof left === `number` && typeof right === `number`) {
			return left - right;
		}

		return String(left).localeCompare(String(right), `de`, { sensitivity: `base`, numeric: true });
	}

	function sortValue(args: { target: Target; key: SortKey }) {
		const { target, key } = args;
		if (key === `name`) return target.name?.trim() || null;
		if (key === `chatJid`) return target.chatJid;
		if (key === `defaultAddress`) return formatAddress(target.defaultAddress);
		if (key === `defaultTimezone`) return target.defaultTimezone;
		if (key === `hasOnlyConsciousEvents`) return target.hasOnlyConsciousEvents ? 1 : 0;
		if (key === `scrapedEvents`) return target.scrapedEvents;
		if (key === `lastRunFinishedAt`) {
			if (!target.lastRunFinishedAt) return null;
			const date = target.lastRunFinishedAt instanceof Date
				? target.lastRunFinishedAt
				: new Date(target.lastRunFinishedAt);
			return Number.isNaN(date.getTime()) ? null : date.getTime();
		}
		return target.lastError?.trim() || null;
	}

	function updateTableScrollWidth() {
		const table = tableScrollEl?.querySelector(`table`);
		tableScrollWidth = table?.scrollWidth ?? 0;
	}

	function syncStickyFromTable() {
		if (!tableScrollEl || !stickyScrollEl || syncingScroll) return;
		syncingScroll = true;
		stickyScrollEl.scrollLeft = tableScrollEl.scrollLeft;
		syncingScroll = false;
	}

	function syncTableFromSticky() {
		if (!tableScrollEl || !stickyScrollEl || syncingScroll) return;
		syncingScroll = true;
		tableScrollEl.scrollLeft = stickyScrollEl.scrollLeft;
		syncingScroll = false;
	}

	function tableScrollAttach(node: HTMLDivElement) {
		tableScrollEl = node;
		const table = node.querySelector(`table`);
		const observer = new ResizeObserver(() => updateTableScrollWidth());
		observer.observe(node);
		if (table) observer.observe(table);
		updateTableScrollWidth();

		return () => {
			observer.disconnect();
			if (tableScrollEl === node) tableScrollEl = null;
		};
	}

	function stickyScrollAttach(node: HTMLDivElement) {
		stickyScrollEl = node;
		return () => {
			if (stickyScrollEl === node) stickyScrollEl = null;
		};
	}

	type Target = (typeof targets)[number];
	type AvailableChat = (typeof availableChats)[number];
	type ChatSourceFilter =
		| `all`
		| `groups`
		| `contacts`
		| `channels`
		| `broadcasts`
		| `other`;
	type SortKey =
		| `name`
		| `chatJid`
		| `defaultAddress`
		| `defaultTimezone`
		| `hasOnlyConsciousEvents`
		| `scrapedEvents`
		| `lastRunFinishedAt`
		| `lastError`;
</script>

<svelte:window onresize={updateTableScrollWidth} />

<div
	class={[
		`fixed inset-x-0 z-0 flex flex-col gap-4 overflow-hidden px-4 pt-4 pb-4`,
		`top-0 bottom-[calc(5.25rem+env(safe-area-inset-bottom))]`,
		`md:top-20 md:bottom-0 md:gap-4 md:pt-0`,
	]}
>
	<div class="mx-auto flex w-full max-w-5xl shrink-0 flex-wrap items-start justify-between gap-3">
		<div class="space-y-1">
			<h1 class="flex items-center gap-2 text-lg font-semibold">
				<i class="icon-[ph--whatsapp-logo] size-6 text-[#25D366]" aria-hidden="true"></i>
				WhatsApp Scraping Targets
			</h1>
			<p class="text-base-content/80 text-sm leading-relaxed">
				Target hinzufügen oder eine Zeile auswählen, um sie zu bearbeiten.
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<button type="button" class="btn btn-primary btn-sm" onclick={openAddDialog}>
				<i class="icon-[ph--plus] size-4"></i>
				Hinzufügen
			</button>
			<a href={routes.admin()} class="btn btn-ghost btn-sm">
				<i class="icon-[ph--arrow-left] size-4"></i>
				Zurück zu Admin
			</a>
		</div>
	</div>

	<div class="card bg-base-100 flex min-h-0 w-full flex-1 flex-col overflow-hidden shadow">
		<div class="flex shrink-0 items-center gap-2 px-6 pt-6">
			<h2 class="card-title text-base">
				Vorhandene Targets
				{#if targets.length}
					<span class="badge badge-ghost">{targets.length}</span>
				{/if}
			</h2>
		</div>

		{#if !targets.length}
			<p class="text-base-content/70 px-6 py-4 text-sm">Noch keine WhatsApp Scraping Targets.</p>
		{:else}
			<div class="flex min-h-0 w-full flex-1 flex-col px-6 pt-4">
				<div
					{@attach tableScrollAttach}
					class="targets-table-scroll min-h-0 w-full flex-1 overflow-x-hidden overflow-y-auto"
					onscroll={syncStickyFromTable}
				>
					<table class="table table-pin-rows table-sm w-full">
						<thead>
							<tr>
								{#each sortColumns as column (column.key)}
									<th
										class="bg-base-100"
										aria-sort={sortKey === column.key
											? sortDir === `asc`
												? `ascending`
												: `descending`
											: `none`}
									>
										<button
											type="button"
											class="hover:text-primary inline-flex items-center gap-1 font-semibold whitespace-nowrap"
											onclick={() => toggleSort(column.key)}
										>
											{column.label}
											<i class={[sortIcon(column.key), `size-3.5 opacity-70`]}></i>
										</button>
									</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each sortedTargets as target (target.chatJid)}
								{@const openUrl = whatsappDirectChatUrl(target.chatJid)}
								<tr
									class={[
										`hover:bg-base-200 cursor-pointer`,
										selectedChatJid === target.chatJid && `bg-primary/10`,
									]}
									onclick={() => selectTarget(target)}
								>
									<td class="min-w-64 font-medium">
										<div class="flex items-center gap-1">
											{#if openUrl}
												<a
													href={openUrl}
													target="_blank"
													rel="noopener noreferrer"
													class="btn btn-ghost btn-square btn-xs"
													title="In WhatsApp öffnen"
													aria-label="In WhatsApp öffnen"
													onclick={(e) => e.stopPropagation()}
												>
													<i class="icon-[ph--arrow-square-out] size-4"></i>
												</a>
											{:else}
												<button
													type="button"
													class="btn btn-ghost btn-square btn-xs"
													title="chatJid kopieren (Gruppen haben keinen Open-Link)"
													aria-label="chatJid kopieren"
													onclick={(e) => copyChatJid({ chatJid: target.chatJid, event: e })}
												>
													<i class="icon-[ph--copy] size-4"></i>
												</button>
											{/if}
											<span>{target.name ?? `—`}</span>
										</div>
									</td>
									<td class="max-w-44 truncate font-mono text-xs whitespace-nowrap" title={target.chatJid}>
										{target.chatJid}
									</td>
									<td class="max-w-48 truncate" title={formatAddress(target.defaultAddress)}>
										{formatAddress(target.defaultAddress)}
									</td>
									<td>{target.defaultTimezone}</td>
									<td>
										{#if target.hasOnlyConsciousEvents}
											<span class="badge badge-success badge-sm">ja</span>
										{:else}
											<span class="badge badge-ghost badge-sm">nein</span>
										{/if}
									</td>
									<td>{target.scrapedEvents}</td>
									<td class="whitespace-nowrap text-xs">{formatDate(target.lastRunFinishedAt)}</td>
									<td class="text-error max-w-48 truncate text-xs" title={target.lastError ?? ``}>
										{target.lastError ?? `—`}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<div
					{@attach stickyScrollAttach}
					class="bg-base-100 sticky bottom-0 z-10 shrink-0 overflow-x-auto border-t border-base-300"
					onscroll={syncTableFromSticky}
					aria-hidden="true"
				>
					<div style:width={`${Math.max(tableScrollWidth, 1)}px`} class="h-3"></div>
				</div>
			</div>
		{/if}
	</div>
</div>

<Dialog.Root open={isAddDialogOpen} onOpenChange={onAddDialogOpenChange}>
	<Dialog.Portal>
		<Dialog.OverlayAnimated />
		<Dialog.ContentAnimated
			class="bg-base-100 fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg shadow-xl"
		>
			<Dialog.Title class="shrink-0 px-6 pt-6 text-lg font-semibold">
				Target hinzufügen
			</Dialog.Title>

			{#if isAddDialogOpen}
				{#if !selectedChatForAdd}
					<div class="flex flex-col gap-3 px-6 py-4">
						<p class="text-base-content/70 text-sm">
							Wähle einen Chat aus, der noch kein Scraping-Target ist.
						</p>
						<div class="flex flex-col gap-2 sm:flex-row">
							<select
								class="select w-full sm:w-44"
								bind:value={chatSourceFilter}
								aria-label="Chat-Quelle filtern"
							>
								{#each chatSourceOptions as option (option.value)}
									<option value={option.value}>{option.label}</option>
								{/each}
							</select>
							<input
								class="input w-full min-w-0 flex-1"
								type="search"
								placeholder="Chat suchen…"
								bind:value={chatFilter}
							/>
						</div>
						{#if hiddenAvailableChatsCount}
							<label class="label cursor-pointer justify-start gap-2">
								<input
									type="checkbox"
									class="checkbox checkbox-sm"
									bind:checked={showHiddenChats}
								/>
								<span class="text-sm">
									Ausgeblendete anzeigen
									<span class="text-base-content/60">({hiddenAvailableChatsCount})</span>
								</span>
							</label>
						{/if}
						{#if !availableChats.length}
							<p class="text-base-content/70 text-sm">
								Keine verfügbaren Chats. Alle bekannten Chats sind bereits Targets.
							</p>
						{:else if !filteredAvailableChats.length}
							<p class="text-base-content/70 text-sm">
								Keine Chats für diese Filterung.
							</p>
						{:else}
							<div class="max-h-[70vh] overflow-y-auto overscroll-contain">
								<ul class="flex w-full flex-col gap-1.5">
									{#each filteredAvailableChats as chat (chat.chatJid)}
										<li class="w-full min-w-0">
											<div
												class={[
													`card card-border bg-base-200 flex w-full min-w-0 flex-row items-start gap-1 rounded-box`,
													chat.hidden && `opacity-60`,
												]}
											>
												<button
													type="button"
													class="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-2.5 py-1.5 text-start"
													onclick={() => selectChatForAdd(chat)}
												>
													<span class="w-full truncate text-sm font-medium">
														{chat.name}
														{#if chat.hidden}
															<span class="badge badge-ghost badge-xs ml-1">ausgeblendet</span>
														{/if}
													</span>
													<span class="w-full break-all font-mono text-xs opacity-70">{chat.chatJid}</span>
													<span class="text-xs opacity-60">
														Letzte Nachricht: {formatDate(chat.lastMessageTime)}
													</span>
												</button>
												<button
													type="button"
													class="btn btn-ghost btn-square btn-xs mt-1 mr-1 shrink-0"
													title={chat.hidden ? `Wieder einblenden` : `Ausblenden`}
													aria-label={chat.hidden ? `Wieder einblenden` : `Ausblenden`}
													disabled={hidingChatJid === chat.chatJid}
													onclick={(e) => toggleChatHidden({ chat, event: e })}
												>
													{#if hidingChatJid === chat.chatJid}
														<span class="loading loading-spinner loading-xs"></span>
													{:else if chat.hidden}
														<i class="icon-[ph--eye] size-4"></i>
													{:else}
														<i class="icon-[ph--eye-slash] size-4"></i>
													{/if}
												</button>
											</div>
										</li>
									{/each}
								</ul>
							</div>
						{/if}
					</div>
				{:else}
					<form {...formProps} class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
						<input type="hidden" {...saveWhatsappScrapingTarget.fields.originalChatJid.as(`text`)} />
						<input type="hidden" {...saveWhatsappScrapingTarget.fields.chatJid.as(`text`)} />
						<input type="hidden" {...saveWhatsappScrapingTarget.fields.name.as(`text`)} />

						<div class="bg-base-200 flex items-start justify-between gap-2 rounded-box p-3">
							<div class="min-w-0 space-y-0.5">
								<p class="truncate font-medium">{selectedChatForAdd.name}</p>
								<p class="font-mono text-xs opacity-70 break-all">{selectedChatForAdd.chatJid}</p>
							</div>
							<button type="button" class="btn btn-ghost btn-sm shrink-0" onclick={clearSelectedChatForAdd}>
								Ändern
							</button>
						</div>

						<fieldset class="fieldset">
							<label class="label cursor-pointer justify-start gap-2">
								<input
									class="checkbox"
									{...saveWhatsappScrapingTarget.fields.hasOnlyConsciousEvents.as(`checkbox`)}
								/>
								<span class="font-bold text-base-content">
									hasOnlyConsciousEvents
									<span class="block text-xs text-base-content/65 font-normal">
										Wenn aktiv, wird der Consciousness-Check übersprungen.
									</span>
								</span>
							</label>
							<FormFieldIssues field={saveWhatsappScrapingTarget.fields.hasOnlyConsciousEvents} />
						</fieldset>

						<fieldset class="fieldset">
							<legend class="fieldset-legend">defaultAddress</legend>
							<textarea
								class="textarea min-h-20 w-full peer"
								{...saveWhatsappScrapingTarget.fields.defaultAddress.as(`text`)}
								placeholder="Optional. Eine oder mehrere Zeilen, z.B. Studio Name, Straße, Stadt"
							></textarea>
							<p class="label">Komma- oder zeilengetrennt. Leer = keine Fallback-Adresse.</p>
							<FormFieldIssues field={saveWhatsappScrapingTarget.fields.defaultAddress} />
						</fieldset>

						<fieldset class="fieldset">
							<legend class="fieldset-legend">defaultTimezone *</legend>
							<input
								class="input w-full peer"
								{...saveWhatsappScrapingTarget.fields.defaultTimezone.as(`text`)}
								required
							/>
							<FormFieldIssues field={saveWhatsappScrapingTarget.fields.defaultTimezone} />
						</fieldset>

						{#if saveWhatsappScrapingTarget.fields.allIssues()?.length}
							<div class="flex flex-col gap-1">
								{#each saveWhatsappScrapingTarget.fields.allIssues() ?? [] as issue, i (`${issue.message}-${i}`)}
									<div class="text-error text-xs">{issue.message}</div>
								{/each}
							</div>
						{/if}

						<div class="flex flex-wrap gap-2 pt-2">
							<button
								type="submit"
								class="btn btn-primary"
								disabled={saveWhatsappScrapingTarget.pending > 0}
							>
								{#if saveWhatsappScrapingTarget.pending > 0}
									<span class="loading loading-spinner loading-sm"></span>
									Wird gespeichert...
								{:else}
									Speichern
								{/if}
							</button>
						</div>
					</form>
				{/if}
			{/if}

			<Dialog.Close
				class="hover:bg-base-200 absolute top-4 right-4 flex size-8 items-center justify-center rounded-full transition-colors"
				aria-label="Schließen"
			>
				<i class="icon-[ph--x] size-6"></i>
			</Dialog.Close>
		</Dialog.ContentAnimated>
	</Dialog.Portal>
</Dialog.Root>

<Dialog.Root open={isEditDialogOpen} onOpenChange={onEditDialogOpenChange}>
	<Dialog.Portal>
		<Dialog.OverlayAnimated />
		<Dialog.ContentAnimated
			class="bg-base-100 fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg shadow-xl"
		>
			<Dialog.Title class="shrink-0 px-6 pt-6 text-lg font-semibold">
				Target bearbeiten
			</Dialog.Title>

			{#if isEditDialogOpen}
				<form {...formProps} class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
					<input type="hidden" {...saveWhatsappScrapingTarget.fields.originalChatJid.as(`text`)} />

					<fieldset class="fieldset">
						<legend class="fieldset-legend">chatJid *</legend>
						<input
							class="input w-full peer font-mono"
							{...saveWhatsappScrapingTarget.fields.chatJid.as(`text`)}
							required
							placeholder="z.B. 120363…@g.us oder 49123…@s.whatsapp.net"
						/>
						<FormFieldIssues field={saveWhatsappScrapingTarget.fields.chatJid} />
					</fieldset>

					<fieldset class="fieldset">
						<label class="label cursor-pointer justify-start gap-2">
							<input
								class="checkbox"
								{...saveWhatsappScrapingTarget.fields.hasOnlyConsciousEvents.as(`checkbox`)}
							/>
							<span class="font-bold text-base-content">
								hasOnlyConsciousEvents
								<span class="block text-xs text-base-content/65 font-normal">
									Wenn aktiv, wird der Consciousness-Check übersprungen.
								</span>
							</span>
						</label>
						<FormFieldIssues field={saveWhatsappScrapingTarget.fields.hasOnlyConsciousEvents} />
					</fieldset>

					<fieldset class="fieldset">
						<legend class="fieldset-legend">Name</legend>
						<input
							class="input w-full peer"
							{...saveWhatsappScrapingTarget.fields.name.as(`text`)}
							placeholder="Anzeigename der Gruppe / des Chats"
						/>
						<FormFieldIssues field={saveWhatsappScrapingTarget.fields.name} />
					</fieldset>

					<fieldset class="fieldset">
						<legend class="fieldset-legend">defaultAddress</legend>
						<textarea
							class="textarea min-h-20 w-full peer"
							{...saveWhatsappScrapingTarget.fields.defaultAddress.as(`text`)}
							placeholder="Optional. Eine oder mehrere Zeilen, z.B. Studio Name, Straße, Stadt"
						></textarea>
						<p class="label">Komma- oder zeilengetrennt. Leer = keine Fallback-Adresse.</p>
						<FormFieldIssues field={saveWhatsappScrapingTarget.fields.defaultAddress} />
					</fieldset>

					<fieldset class="fieldset">
						<legend class="fieldset-legend">defaultTimezone *</legend>
						<input
							class="input w-full peer"
							{...saveWhatsappScrapingTarget.fields.defaultTimezone.as(`text`)}
							required
						/>
						<FormFieldIssues field={saveWhatsappScrapingTarget.fields.defaultTimezone} />
					</fieldset>

					{#if saveWhatsappScrapingTarget.fields.allIssues()?.length}
						<div class="flex flex-col gap-1">
							{#each saveWhatsappScrapingTarget.fields.allIssues() ?? [] as issue, i (`${issue.message}-${i}`)}
								<div class="text-error text-xs">{issue.message}</div>
							{/each}
						</div>
					{/if}

					<div class="flex flex-wrap gap-2 pt-2">
						<button
							type="submit"
							class="btn btn-primary"
							disabled={saveWhatsappScrapingTarget.pending > 0}
						>
							{#if saveWhatsappScrapingTarget.pending > 0}
								<span class="loading loading-spinner loading-sm"></span>
								Wird gespeichert...
							{:else}
								Speichern
							{/if}
						</button>
					</div>
				</form>
			{/if}

			<Dialog.Close
				class="hover:bg-base-200 absolute top-4 right-4 flex size-8 items-center justify-center rounded-full transition-colors"
				aria-label="Schließen"
			>
				<i class="icon-[ph--x] size-6"></i>
			</Dialog.Close>
		</Dialog.ContentAnimated>
	</Dialog.Portal>
</Dialog.Root>

<style>
	/* Vertical scrollbar only; horizontal scrolling uses the sticky bar below. */
	.targets-table-scroll {
		scrollbar-width: thin;
	}

	.targets-table-scroll::-webkit-scrollbar {
		width: 8px;
	}
</style>
