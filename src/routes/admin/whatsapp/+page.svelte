<script lang="ts">
	import FormFieldIssues from '$lib/components/FormFieldIssues.svelte';
	import { routes } from '$lib/routes';
	import {
		getWhatsappScrapingTargets,
		saveWhatsappScrapingTarget,
	} from '$lib/rpc/adminWhatsapp.remote';
	import { toast } from 'svelte-sonner';

	const targets = $derived(await getWhatsappScrapingTargets());
	const defaultFormValues = {
		originalChatJid: ``,
		chatJid: ``,
		name: ``,
		defaultAddress: ``,
		defaultTimezone: `germany`,
		hasOnlyConsciousEvents: false,
	};

	let selectedChatJid = $state<string | null>(null);
	const isEditing = $derived(!!selectedChatJid);

	saveWhatsappScrapingTarget.fields.set(defaultFormValues);

	const formProps = saveWhatsappScrapingTarget.enhance(async (form) => {
		const ok = await form.submit().updates(getWhatsappScrapingTargets);
		if (!ok) return;

		const result = form.result;
		const name = result?.name;
		if (result?.action === `updated`) {
			toast.success(name ? `Target „${name}“ aktualisiert` : `Target aktualisiert`);
			selectedChatJid = result.chatJid;
			saveWhatsappScrapingTarget.fields.originalChatJid.set(result.chatJid);
			saveWhatsappScrapingTarget.fields.chatJid.set(result.chatJid);
			return;
		}

		toast.success(name ? `Target „${name}“ hinzugefügt` : `Target hinzugefügt`);
		resetForm();
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

	function resetForm() {
		selectedChatJid = null;
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

<div class="flex w-full flex-col gap-6 px-4 py-4 md:py-0 md:pb-10">
	<div class="mx-auto flex w-full max-w-5xl flex-wrap items-start justify-between gap-3">
		<div class="space-y-1">
			<h1 class="text-lg font-semibold">WhatsApp Scraping Targets</h1>
			<p class="text-base-content/80 text-sm leading-relaxed">
				Targets hinzufügen oder eine Zeile auswählen, um sie zu bearbeiten.
			</p>
		</div>
		<a href={routes.admin()} class="btn btn-ghost btn-sm">
			<i class="icon-[ph--arrow-left] size-4"></i>
			Zurück zu Admin
		</a>
	</div>

	<div class="card bg-base-100 mx-auto w-full max-w-5xl shadow">
		<div class="card-body gap-4">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<h2 class="card-title text-base">
					{#if isEditing}
						Target bearbeiten
					{:else}
						Neues Target hinzufügen
					{/if}
				</h2>
				{#if isEditing}
					<button type="button" class="btn btn-ghost btn-sm" onclick={resetForm}>
						Neu
					</button>
				{/if}
			</div>

			<form {...formProps} class="grid grid-cols-1 gap-4 md:grid-cols-2">
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

				<fieldset class="fieldset md:col-span-2">
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
					<div class="md:col-span-2 flex flex-col gap-1">
						{#each saveWhatsappScrapingTarget.fields.allIssues() ?? [] as issue, i (`${issue.message}-${i}`)}
							<div class="text-error text-xs">{issue.message}</div>
						{/each}
					</div>
				{/if}

				<div class="md:col-span-2 flex flex-wrap gap-2">
					<button
						type="submit"
						class="btn btn-primary"
						disabled={saveWhatsappScrapingTarget.pending > 0}
					>
						{#if saveWhatsappScrapingTarget.pending > 0}
							<span class="loading loading-spinner loading-sm"></span>
							Wird gespeichert...
						{:else if isEditing}
							Speichern
						{:else}
							Target hinzufügen
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>

	<div class="card bg-base-100 w-full shadow">
		<div class="card-body gap-4">
			<h2 class="card-title text-base">
				Vorhandene Targets
				{#if targets.length}
					<span class="badge badge-ghost">{targets.length}</span>
				{/if}
			</h2>

			{#if !targets.length}
				<p class="text-base-content/70 text-sm">Noch keine WhatsApp Scraping Targets.</p>
			{:else}
				<div class="flex max-h-[min(70vh,40rem)] w-full flex-col">
					<div
						{@attach tableScrollAttach}
						class="targets-table-scroll min-h-0 w-full flex-1 overflow-auto"
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
										<td class="font-medium">
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
										<td class="font-mono text-xs whitespace-nowrap">{target.chatJid}</td>
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
</div>

<style>
	.targets-table-scroll {
		scrollbar-width: thin;
	}

	.targets-table-scroll::-webkit-scrollbar {
		width: 8px;
		height: 0;
	}
</style>
