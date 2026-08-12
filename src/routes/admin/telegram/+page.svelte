<script lang="ts">
	import FormFieldIssues from '$lib/components/FormFieldIssues.svelte';
	import { Dialog } from '$lib/components/dialog';
	import { routes } from '$lib/routes';
	import {
		deleteTelegramScrapingTarget,
		getTelegramScrapingTargets,
		saveTelegramScrapingTarget,
	} from '$lib/rpc/adminTelegram.remote';
	import { toast } from 'svelte-sonner';

	let { data } = $props();
	const targetsQuery = getTelegramScrapingTargets();
	const targets = $derived(targetsQuery.current ?? data.targets);
	const defaultFormValues = {
		originalRoomId: ``,
		roomId: ``,
		defaultAddress: ``,
		topicIds: ``,
		defaultTimezone: `germany`,
		hasOnlyConsciousEvents: false,
	};

	let isAddDialogOpen = $state(false);
	let isEditDialogOpen = $state(false);
	let selectedRoomId = $state<string | null>(null);
	let isDeleting = $state(false);
	const selectedTarget = $derived(targets.find((target) => target.roomId === selectedRoomId) ?? null);

	saveTelegramScrapingTarget.fields.set(defaultFormValues);

	const formProps = saveTelegramScrapingTarget.enhance(async (form) => {
		const ok = await form.submit().updates(getTelegramScrapingTargets);
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
		saveTelegramScrapingTarget.fields.set(defaultFormValues);
		isAddDialogOpen = true;
	}

	function closeAddDialog() {
		isAddDialogOpen = false;
		saveTelegramScrapingTarget.fields.set(defaultFormValues);
	}

	function onAddDialogOpenChange(open: boolean) {
		if (open) {
			isAddDialogOpen = true;
			return;
		}
		closeAddDialog();
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
			await getTelegramScrapingTargets().refresh();
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
	type SortKey =
		| `name`
		| `roomId`
		| `defaultAddress`
		| `topicIds`
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
						<legend class="fieldset-legend">defaultTimezone *</legend>
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
							disabled={saveTelegramScrapingTarget.pending > 0}
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
						<legend class="fieldset-legend">defaultTimezone *</legend>
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
							disabled={isDeleting || saveTelegramScrapingTarget.pending > 0}
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
