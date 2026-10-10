<script lang="ts">
	/* @wc-ignore-file */
	import FormFieldIssues from '$lib/components/FormFieldIssues.svelte';
	import { Dialog } from '$lib/components/dialog';
	import { routes } from '$lib/routes';
	import {
		deleteTelegramScrapingTarget,
		getAvailableTelegramDialogs,
		getTelegramScrapingTargets,
		lookupTimezoneFromAddress,
		saveTelegramScrapingTarget,
	} from '$lib/rpc/adminTelegram.remote';
	import { TableStickyScroll } from '$lib/tableStickyScroll.svelte';
	import { toast } from 'svelte-sonner';

	let { data } = $props();
	const targetsQuery = getTelegramScrapingTargets();
	const availableDialogsQuery = getAvailableTelegramDialogs();
	const targets = $derived(targetsQuery.current ?? data.targets);
	const availableDialogs = $derived(availableDialogsQuery.current ?? data.availableDialogs);
	const defaultFormValues = {
		originalRoomId: ``,
		roomId: ``,
		defaultAddress: ``,
		topicIds: ``,
		defaultTimezone: `Europe/Berlin`,
		hasOnlyConsciousEvents: false,
	};

	let isAddDialogOpen = $state(false);
	let isEditDialogOpen = $state(false);
	let selectedRoomId = $state<string | null>(null);
	let selectedDialogForAdd = $state<{ roomId: string; name: string } | null>(null);
	let dialogFilter = $state(``);
	let dialogKindFilter = $state<DialogKindFilter>(`groups`);
	let isDeleting = $state(false);
	let timezoneLookupAddress = ``;
	const selectedTarget = $derived(targets.find((target) => target.roomId === selectedRoomId) ?? null);

	const dialogKindOptions = [
		{ value: `all`, label: `Alle` },
		{ value: `groups`, label: `Gruppen` },
		{ value: `channels`, label: `Kanäle` },
	] as const;

	const filteredAvailableDialogs = $derived.by(() => {
		const query = dialogFilter.trim().toLowerCase();
		return availableDialogs.filter((dialog) => {
			if (dialogKindFilter === `groups` && dialog.kind !== `group`) return false;
			if (dialogKindFilter === `channels` && dialog.kind !== `channel`) return false;
			if (!query) return true;
			return (
				dialog.name.toLowerCase().includes(query) ||
				dialog.roomId.toLowerCase().includes(query) ||
				(dialog.username?.toLowerCase().includes(query) ?? false)
			);
		});
	});

	saveTelegramScrapingTarget.fields.set(defaultFormValues);

	const formProps = saveTelegramScrapingTarget.enhance(async (form) => {
		const ok = await form.submit().updates(getTelegramScrapingTargets, getAvailableTelegramDialogs);
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
		{ key: `roomId`, label: `roomId` },
		{ key: `defaultAddress`, label: `Adresse` },
		{ key: `topicIds`, label: `Topics` },
		{ key: `defaultTimezone`, label: `Timezone` },
		{ key: `hasOnlyConsciousEvents`, label: `Conscious only` },
		{ key: `scrapedEvents`, label: `Events` },
		{ key: `lastEventCreatedAt`, label: `Letztes Event` },
		{ key: `lastRunFinishedAt`, label: `Letzter Lauf` },
		{ key: `lastError`, label: `Fehler` },
	];

	let sortKey = $state<SortKey>(`name`);
	let sortDir = $state<`asc` | `desc`>(`asc`);
	const tableScroll = new TableStickyScroll();

	const sortedTargets = $derived.by(() => {
		const dir = sortDir === `asc` ? 1 : -1;
		return [...targets].sort((a, b) => compareTargets({ a, b, key: sortKey }) * dir);
	});

	function openAddDialog() {
		selectedDialogForAdd = null;
		dialogFilter = ``;
		dialogKindFilter = `groups`;
		saveTelegramScrapingTarget.fields.set(defaultFormValues);
		void availableDialogsQuery.refresh();
		isAddDialogOpen = true;
	}

	function closeAddDialog() {
		isAddDialogOpen = false;
		selectedDialogForAdd = null;
		dialogFilter = ``;
		dialogKindFilter = `groups`;
		saveTelegramScrapingTarget.fields.set(defaultFormValues);
	}

	function onAddDialogOpenChange(open: boolean) {
		if (open) {
			isAddDialogOpen = true;
			return;
		}
		closeAddDialog();
	}

	function selectDialogForAdd(dialog: AvailableDialog) {
		selectedDialogForAdd = { roomId: dialog.roomId, name: dialog.name };
		saveTelegramScrapingTarget.fields.set({
			...defaultFormValues,
			roomId: dialog.roomId,
		});
	}

	function clearSelectedDialogForAdd() {
		selectedDialogForAdd = null;
		saveTelegramScrapingTarget.fields.set(defaultFormValues);
	}

	async function fillTimezoneFromAddress(address: string) {
		const trimmed = address.trim();
		if (!trimmed) return;

		timezoneLookupAddress = trimmed;
		try {
			const timezone = await lookupTimezoneFromAddress({ address: trimmed });
			if (timezoneLookupAddress !== trimmed) return;
			if (!timezone) {
				toast.error(`Zeitzone zur Adresse nicht gefunden`);
				return;
			}
			saveTelegramScrapingTarget.fields.defaultTimezone.set(timezone);
		} catch (error) {
			if (timezoneLookupAddress !== trimmed) return;
			console.error(`Failed to look up timezone:`, error);
			toast.error(`Zeitzone konnte nicht ermittelt werden`);
		}
	}

	function selectTarget(target: Target) {
		selectedRoomId = target.roomId;
		saveTelegramScrapingTarget.fields.set({
			originalRoomId: target.roomId,
			roomId: target.roomId,
			defaultAddress: target.defaultAddress?.join(`\n`) ?? ``,
			topicIds: target.topicIds.join(`, `),
			defaultTimezone: target.defaultTimezone,
			hasOnlyConsciousEvents: target.hasOnlyConsciousEvents,
		});
		isEditDialogOpen = true;
	}

	function onEditDialogOpenChange(open: boolean) {
		isEditDialogOpen = open;
		if (open) return;
		selectedRoomId = null;
		isDeleting = false;
		saveTelegramScrapingTarget.fields.set(defaultFormValues);
	}

	async function deleteSelectedTarget() {
		if (!selectedTarget || isDeleting) return;

		const label = selectedTarget.name?.trim() || selectedTarget.roomId;
		if (!confirm(`Target „${label}“ wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`)) {
			return;
		}

		isDeleting = true;
		try {
			await deleteTelegramScrapingTarget({ roomId: selectedTarget.roomId });
			await Promise.all([
				getTelegramScrapingTargets().refresh(),
				getAvailableTelegramDialogs().refresh(),
			]);
			toast.success(`Target „${label}“ gelöscht`);
			onEditDialogOpenChange(false);
		} catch (err) {
			console.error(`Failed to delete telegram scraping target:`, err);
			toast.error(`Target konnte nicht gelöscht werden`);
		} finally {
			isDeleting = false;
		}
	}

	function formatTopicIds(topicIds: string[] | null | undefined) {
		if (!topicIds?.length) return `—`;
		return topicIds.join(`, `);
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

	function telegramRoomUrl(roomId: string) {
		const trimmed = roomId.trim();
		if (!trimmed || trimmed.includes(`resolveName:`)) return null;

		if (trimmed.startsWith(`@`)) {
			return `https://t.me/${trimmed.slice(1)}`;
		}
		if (/^[A-Za-z]\w{3,31}$/.test(trimmed)) {
			return `https://t.me/${trimmed}`;
		}
		if (/^-100\d+$/.test(trimmed)) {
			return `https://t.me/c/${trimmed.slice(4)}/1`;
		}
		if (/^-?\d+$/.test(trimmed)) {
			return `tg://openmessage?chat_id=${trimmed}`;
		}
		return null;
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
		if (key === `roomId`) return target.roomId;
		if (key === `defaultAddress`) return formatAddress(target.defaultAddress);
		if (key === `topicIds`) return formatTopicIds(target.topicIds);
		if (key === `defaultTimezone`) return target.defaultTimezone;
		if (key === `hasOnlyConsciousEvents`) return target.hasOnlyConsciousEvents ? 1 : 0;
		if (key === `scrapedEvents`) return target.scrapedEvents;
		if (key === `lastEventCreatedAt` || key === `lastRunFinishedAt`) {
			const value = target[key];
			if (!value) return null;
			const date = value instanceof Date ? value : new Date(value);
			return Number.isNaN(date.getTime()) ? null : date.getTime();
		}
		return target.lastError?.trim() || null;
	}

	type Target = (typeof targets)[number];
	type AvailableDialog = (typeof availableDialogs)[number];
	type DialogKindFilter = `all` | `groups` | `channels`;
	type SortKey =
		| `name`
		| `roomId`
		| `defaultAddress`
		| `topicIds`
		| `defaultTimezone`
		| `hasOnlyConsciousEvents`
		| `scrapedEvents`
		| `lastEventCreatedAt`
		| `lastRunFinishedAt`
		| `lastError`;
</script>

<svelte:window onresize={tableScroll.updateTableScrollWidth} />

<div
	class={[
		`fixed inset-x-0 z-0 flex flex-col gap-4 overflow-hidden px-4 pt-4 pb-4`,
		`top-0 bottom-[calc(5.25rem+env(safe-area-inset-bottom))]`,
		`md:top-20 md:bottom-[calc(2rem+1px)] md:gap-4 md:pt-0`,
	]}
>
	<div class="mx-auto flex w-full max-w-5xl shrink-0 flex-wrap items-start justify-between gap-3">
		<div class="space-y-1">
			<h1 class="flex items-center gap-2 text-lg font-semibold">
				<i class="icon-[ph--telegram-logo] size-6 text-[#26A5E4]" aria-hidden="true"></i>
				Telegram Scraping Targets
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
			<p class="text-base-content/70 px-6 py-4 text-sm">Noch keine Telegram Scraping Targets.</p>
		{:else}
			<div class="flex min-h-0 w-full flex-1 flex-col px-6 pt-4">
				<div
					{@attach tableScroll.tableScrollAttach}
					class="targets-table-scroll min-h-0 w-full flex-1 overflow-x-auto overflow-y-auto"
					onscroll={tableScroll.syncStickyFromTable}
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
							{#each sortedTargets as target (target.roomId)}
								{@const openUrl = telegramRoomUrl(target.roomId)}
								<tr
									class={[
										`hover:bg-base-200 cursor-pointer`,
										selectedRoomId === target.roomId && `bg-primary/10`,
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
													title="In Telegram öffnen"
													aria-label="In Telegram öffnen"
													onclick={(e) => e.stopPropagation()}
												>
													<i class="icon-[ph--arrow-square-out] size-4"></i>
												</a>
											{/if}
											<span>{target.name ?? `—`}</span>
										</div>
									</td>
									<td class="max-w-44 truncate font-mono text-xs whitespace-nowrap" title={target.roomId}>
										{target.roomId}
									</td>
									<td class="max-w-48 truncate" title={formatAddress(target.defaultAddress)}>
										{formatAddress(target.defaultAddress)}
									</td>
									<td class="max-w-28 truncate font-mono text-xs" title={formatTopicIds(target.topicIds)}>
										{formatTopicIds(target.topicIds)}
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
									<td class="whitespace-nowrap text-xs">{formatDate(target.lastEventCreatedAt)}</td>
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
					{@attach tableScroll.stickyScrollAttach}
					class="bg-base-100 sticky bottom-0 z-10 shrink-0 overflow-x-auto border-t border-base-300"
					onscroll={tableScroll.syncTableFromSticky}
					aria-hidden="true"
				>
					<div style:width={`${Math.max(tableScroll.tableScrollWidth, 1)}px`} class="h-3"></div>
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
			data-testid="telegram-add-dialog"
		>
			<Dialog.Title class="shrink-0 px-6 pt-6 text-lg font-semibold">
				Target hinzufügen
			</Dialog.Title>

			{#if isAddDialogOpen}
				{#if !selectedDialogForAdd}
					<div class="flex flex-col gap-3 px-6 py-4">
						<p class="text-base-content/70 text-sm">
							Wähle eine Gruppe oder einen Kanal aus, der noch kein Scraping-Target ist.
						</p>
						<div class="flex flex-col gap-2 sm:flex-row">
							<select
								class="select w-full sm:w-44"
								bind:value={dialogKindFilter}
								aria-label="Art filtern"
								data-testid="telegram-dialog-kind-filter"
							>
								{#each dialogKindOptions as option (option.value)}
									<option value={option.value}>{option.label}</option>
								{/each}
							</select>
							<input
								class="input w-full min-w-0 flex-1"
								type="search"
								placeholder="Gruppe/Kanal suchen…"
								bind:value={dialogFilter}
								data-testid="telegram-dialog-filter"
							/>
						</div>
						{#if availableDialogsQuery.loading}
							<div class="flex items-center gap-2">
								<span class="loading loading-spinner loading-xs"></span>
								<span class="text-base-content/70 text-sm">Lade…</span>
							</div>
						{/if}
						{#if !availableDialogs.length}
							{#if !availableDialogsQuery.loading}
								<p class="text-base-content/70 text-sm">
									Keine verfügbaren Gruppen/Kanäle. Alle sind bereits Targets, oder TELEGRAM_APP_SESSION_PRIMARY fehlt bzw. der Primary-Account ist noch in keiner Gruppe.
								</p>
							{/if}
						{:else if !filteredAvailableDialogs.length}
							<p class="text-base-content/70 text-sm">
								Keine Einträge für diese Filterung.
							</p>
						{:else}
							<div class="max-h-[70vh] overflow-y-auto overscroll-contain">
								<ul class="flex w-full flex-col gap-1.5">
									{#each filteredAvailableDialogs as dialog (dialog.roomId)}
										<li class="w-full min-w-0">
											<button
												type="button"
												class="card card-border bg-base-200 flex w-full min-w-0 flex-col items-start gap-0.5 rounded-box px-2.5 py-1.5 text-start"
												data-testid="telegram-dialog-option"
												onclick={() => selectDialogForAdd(dialog)}
											>
												<span class="flex w-full min-w-0 items-center gap-1.5">
													<span class="truncate text-sm font-medium">{dialog.name}</span>
													<span class="badge badge-ghost badge-xs shrink-0">
														{dialog.kind === `channel` ? `Kanal` : `Gruppe`}
													</span>
												</span>
												{#if dialog.username}
													<span class="w-full truncate text-xs opacity-70">@{dialog.username}</span>
												{/if}
												<span class="w-full break-all font-mono text-xs opacity-70">{dialog.roomId}</span>
												<span class="text-xs opacity-60">
													Letzte Nachricht: {formatDate(dialog.lastMessageTime)}
												</span>
											</button>
										</li>
									{/each}
								</ul>
							</div>
						{/if}
					</div>
				{:else}
					<form {...formProps} class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
						<input type="hidden" {...saveTelegramScrapingTarget.fields.originalRoomId.as(`text`)} />
						<input type="hidden" {...saveTelegramScrapingTarget.fields.roomId.as(`text`)} />

						<div class="bg-base-200 flex items-start justify-between gap-2 rounded-box p-3">
							<div class="min-w-0 space-y-0.5">
								<p class="truncate font-medium">{selectedDialogForAdd.name}</p>
								<p class="font-mono text-xs opacity-70 break-all">{selectedDialogForAdd.roomId}</p>
							</div>
							<button type="button" class="btn btn-ghost btn-sm shrink-0" onclick={clearSelectedDialogForAdd}>
								Ändern
							</button>
						</div>

						<fieldset class="fieldset">
							<label class="label cursor-pointer justify-start gap-2">
								<input
									class="checkbox"
									{...saveTelegramScrapingTarget.fields.hasOnlyConsciousEvents.as(`checkbox`)}
								/>
								<span class="font-bold text-base-content">
									hasOnlyConsciousEvents
									<span class="block text-xs text-base-content/65 font-normal">
										Wenn aktiv, wird der Consciousness-Check übersprungen.
									</span>
								</span>
							</label>
							<FormFieldIssues field={saveTelegramScrapingTarget.fields.hasOnlyConsciousEvents} />
						</fieldset>

						<fieldset class="fieldset">
							<legend class="fieldset-legend">defaultAddress</legend>
							<textarea
								class="textarea min-h-20 w-full peer"
								{...saveTelegramScrapingTarget.fields.defaultAddress.as(`text`)}
								placeholder="Optional. Eine oder mehrere Zeilen, z.B. Studio Name, Straße, Stadt"
								onblur={(event) => void fillTimezoneFromAddress(event.currentTarget.value)}
							></textarea>
							<p class="label">Komma- oder zeilengetrennt. Leer = keine Fallback-Adresse.</p>
							<FormFieldIssues field={saveTelegramScrapingTarget.fields.defaultAddress} />
						</fieldset>

						<fieldset class="fieldset">
							<legend class="fieldset-legend">topicIds</legend>
							<input
								class="input w-full peer font-mono"
								{...saveTelegramScrapingTarget.fields.topicIds.as(`text`)}
								placeholder="z.B. 1, 2 oder -1"
							/>
							<p class="label">Kommagetrennte Zahlen. Leer = keine Topics, -1 = alle Topics.</p>
							<FormFieldIssues field={saveTelegramScrapingTarget.fields.topicIds} />
						</fieldset>

						<fieldset class="fieldset">
							<legend class="fieldset-legend">
								defaultTimezone *
								{#if lookupTimezoneFromAddress.pending > 0}
									<span class="loading loading-spinner loading-xs"></span>
								{/if}
							</legend>
							<input
								class="input w-full peer"
								{...saveTelegramScrapingTarget.fields.defaultTimezone.as(`text`)}
								required
							/>
							<FormFieldIssues field={saveTelegramScrapingTarget.fields.defaultTimezone} />
						</fieldset>

						{#if saveTelegramScrapingTarget.fields.allIssues()?.length}
							<div class="flex flex-col gap-1">
								{#each saveTelegramScrapingTarget.fields.allIssues() ?? [] as issue, i (`${issue.message}-${i}`)}
									<div class="text-error text-xs">{issue.message}</div>
								{/each}
							</div>
						{/if}

						<div class="flex flex-wrap gap-2 pt-2">
							<button
								type="submit"
								class="btn btn-primary"
								disabled={saveTelegramScrapingTarget.pending > 0 || lookupTimezoneFromAddress.pending > 0}
							>
								{#if saveTelegramScrapingTarget.pending > 0}
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
					<input type="hidden" {...saveTelegramScrapingTarget.fields.originalRoomId.as(`text`)} />

					<fieldset class="fieldset">
						<legend class="fieldset-legend">roomId *</legend>
						<input
							class="input w-full peer"
							{...saveTelegramScrapingTarget.fields.roomId.as(`text`)}
							required
							placeholder="t.me/…, -100123…, @channel oder resolveName:Chat Name"
						/>
						<FormFieldIssues field={saveTelegramScrapingTarget.fields.roomId} />
					</fieldset>

					<fieldset class="fieldset">
						<label class="label cursor-pointer justify-start gap-2">
							<input
								class="checkbox"
								{...saveTelegramScrapingTarget.fields.hasOnlyConsciousEvents.as(`checkbox`)}
							/>
							<span class="font-bold text-base-content">
								hasOnlyConsciousEvents
								<span class="block text-xs text-base-content/65 font-normal">
									Wenn aktiv, wird der Consciousness-Check übersprungen.
								</span>
							</span>
						</label>
						<FormFieldIssues field={saveTelegramScrapingTarget.fields.hasOnlyConsciousEvents} />
					</fieldset>

					<fieldset class="fieldset">
						<legend class="fieldset-legend">defaultAddress</legend>
						<textarea
							class="textarea min-h-20 w-full peer"
							{...saveTelegramScrapingTarget.fields.defaultAddress.as(`text`)}
							placeholder="Optional. Eine oder mehrere Zeilen, z.B. Studio Name, Straße, Stadt"
							onblur={(event) => void fillTimezoneFromAddress(event.currentTarget.value)}
						></textarea>
						<p class="label">Komma- oder zeilengetrennt. Leer = keine Fallback-Adresse.</p>
						<FormFieldIssues field={saveTelegramScrapingTarget.fields.defaultAddress} />
					</fieldset>

					<fieldset class="fieldset">
						<legend class="fieldset-legend">topicIds</legend>
						<input
							class="input w-full peer font-mono"
							{...saveTelegramScrapingTarget.fields.topicIds.as(`text`)}
							placeholder="z.B. 1, 2 oder -1"
						/>
						<p class="label">Kommagetrennte Zahlen. Leer = keine Topics, -1 = alle Topics.</p>
						<FormFieldIssues field={saveTelegramScrapingTarget.fields.topicIds} />
					</fieldset>

					<fieldset class="fieldset">
						<legend class="fieldset-legend">
							defaultTimezone *
							{#if lookupTimezoneFromAddress.pending > 0}
								<span class="loading loading-spinner loading-xs"></span>
							{/if}
						</legend>
						<input
							class="input w-full peer"
							{...saveTelegramScrapingTarget.fields.defaultTimezone.as(`text`)}
							required
						/>
						<FormFieldIssues field={saveTelegramScrapingTarget.fields.defaultTimezone} />
					</fieldset>

					{#if saveTelegramScrapingTarget.fields.allIssues()?.length}
						<div class="flex flex-col gap-1">
							{#each saveTelegramScrapingTarget.fields.allIssues() ?? [] as issue, i (`${issue.message}-${i}`)}
								<div class="text-error text-xs">{issue.message}</div>
							{/each}
						</div>
					{/if}

					<div class="flex flex-wrap items-center justify-between gap-2 pt-2">
						<button
							type="button"
							class="btn btn-error btn-outline"
							disabled={isDeleting || saveTelegramScrapingTarget.pending > 0}
							onclick={deleteSelectedTarget}
						>
							{#if isDeleting}
								<span class="loading loading-spinner loading-sm"></span>
								Wird gelöscht...
							{:else}
								<i class="icon-[ph--trash] size-4"></i>
								Löschen
							{/if}
						</button>
						<button
							type="submit"
							class="btn btn-primary"
							disabled={isDeleting || saveTelegramScrapingTarget.pending > 0 || lookupTimezoneFromAddress.pending > 0}
						>
							{#if saveTelegramScrapingTarget.pending > 0}
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
