<script lang="ts">
	import { page } from '$app/state';
	import EventForm from '$lib/components/EventForm.svelte';
	import { createEvent } from '$lib/rpc/eventMutations.remote';
	import { prefillEventFromDescription } from '$lib/rpc/prefillEventFromDescription.remote';
	import { formatDateForLocalInput } from '$lib/events.remote.common';
	import { getDefaultCreateEventFieldBase } from '$lib/eventCreateDefaults';
	import type { CreateEventPrefillFields } from '$lib/server/mapAiAnswerToCreateEventPrefill';
	import { resolve } from '$app/paths';
	import { routes } from '$lib/routes';
	import { fade } from 'svelte/transition';

	const showCreate = $derived(page.url.searchParams.get(`create`) === `1`);

	let phase = $state<`paste` | `form`>(`paste`);
	let pasteText = $state(``);
	let isPrefilling = $state(false);
	let prefillBanner = $state<{ kind: `source` | `noEvent` | `error`; text: string } | null>(null);

	const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

	function getDefaultCreateFields() {
		return getDefaultCreateEventFieldBase({ timeZone });
	}

	function mergePrefill(
		base: ReturnType<typeof getDefaultCreateFields>,
		prefill: CreateEventPrefillFields
	) {
		return {
			...base,
			name: prefill.name || base.name,
			description: prefill.description || base.description,
			tagIds: prefill.tagIds?.length ? prefill.tagIds : base.tagIds,
			price: prefill.price || base.price,
			address: prefill.address || base.address,
			startAt: prefill.startAtIso
				? formatDateForLocalInput(new Date(prefill.startAtIso))
				: base.startAt,
			endAt: prefill.endAtIso ? formatDateForLocalInput(new Date(prefill.endAtIso)) : ``,
			isOnline: prefill.isOnline,
			isNotListed: prefill.isNotListed,
			contact: prefill.contact || ``,
			contactMethod: prefill.contactMethod || `none`
		};
	}

	async function goToFormFromPaste() {
		prefillBanner = null;
		const defaults = getDefaultCreateFields();
		if (!pasteText.trim()) {
			createEvent.fields.set(defaults);
			phase = `form`;
			return;
		}

		isPrefilling = true;
		try {
			const result = await prefillEventFromDescription({ text: pasteText, timeZone });
			if (result.kind === `empty`) {
				createEvent.fields.set(defaults);
				phase = `form`;
				return;
			}
			if (result.fields.notice === `existingSource` && result.fields.existingSource) {
				prefillBanner = {
					kind: `source`,
					text: `Der Text scheint von einer bestehenden Quelle zu stammen. Wir importieren regelmäßig Events von <b>${result.fields.existingSource}</b>. Der Event ist also schon bei uns gelistet oder wird es in kürze sein.`
				};
				return;
			}
			const merged = mergePrefill(defaults, result.fields);
			createEvent.fields.set(merged);
			if (result.fields.notice === `noEventData`) {
				prefillBanner = {
					kind: `noEvent`,
					text: `Es wurde kein klarer Event in dem Text erkannt. Du kannst das Formular trotzdem ausfüllen.`
				};
			}
			phase = `form`;
		} catch (e) {
			console.error(e);
			createEvent.fields.set(defaults);
			prefillBanner = {
				kind: `error`,
				text: `Fehler beim importieren. Du kannst das Formular trotzdem ausfüllen`
			};
			phase = `form`;
		} finally {
			isPrefilling = false;
		}
	}
</script>

<div class="mx-auto w-full max-w-3xl px-0 sm:px-4 md:pb-6">
	<div class="card bg-base-100 sm:rounded-box w-full rounded-none shadow">
		{#if showCreate}
			{#if phase === `paste`}
				<div class="card-body gap-6 p-4 sm:p-6" in:fade={{ duration: 200 }}>
					<div class="flex items-start justify-between gap-3">
						<div>
							<h1 class="text-xl font-bold">Event Importieren</h1>
							<p class="text-base-content/80 mt-1 text-sm">
								Füge eine Event Beschreibung aus WhatsApp, Telegram etc ein, dann importieren wir
								die Daten.
							</p>
						</div>
					</div>

					<fieldset class="fieldset">
						<textarea
							class="textarea min-h-20 w-full font-mono text-sm"
							bind:value={pasteText}
							disabled={isPrefilling}
							placeholder="WhatsApp/Telegram Beschreibung einfügen…"
						></textarea>
						<legend class="fieldset-legend">Optional</legend>
					</fieldset>

					<div class="flex flex-col-reverse justify-end gap-6 sm:flex-row">
						<button
							type="button"
							onclick={() => history.back()}
							class="btn disabled:bg-base-300 disabled:text-base-content"
							disabled={isPrefilling}
						>
							Abbrechen
						</button>
						<button
							type="button"
							onclick={goToFormFromPaste}
							class="btn btn-primary disabled:bg-primary disabled:text-primary-content"
							disabled={isPrefilling}
						>
							{#if isPrefilling}
								<span class="loading loading-spinner loading-sm"></span>
								Analysiere Text …
							{:else}
								{#if pasteText.trim()}
									Event importieren
								{:else}
									Weiter ohne importieren
								{/if}
								<i class="icon-[ph--arrow-right] size-5"></i>
							{/if}
						</button>
					</div>

					{#if prefillBanner?.kind === `source`}
						<div class="alert alert-warning alert-soft" role="status">
							<i class="icon-[ph--info] size-5 shrink-0"></i>
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- banner text is generated locally with a trusted source name. -->
							<span>{@html prefillBanner.text}</span>
						</div>
					{/if}
				</div>
			{:else}
				<div class="card-body gap-6 p-4 sm:p-6" in:fade={{ duration: 200 }}>
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div>
							<h1 class="text-2xl font-bold">Event erstellen</h1>
						</div>
					</div>

					{#if prefillBanner && prefillBanner.kind !== `source`}
						<div
							class="alert {prefillBanner.kind === `error`
								? `alert-error`
								: `alert-info`} alert-soft"
							role={prefillBanner.kind === `error` ? `alert` : `status`}
						>
							{#if prefillBanner.kind === `error`}
								<i class="icon-[ph--warning-circle] size-5 shrink-0"></i>
							{:else}
								<i class="icon-[ph--info] size-5 shrink-0"></i>
							{/if}
							<span>{prefillBanner.text}</span>
						</div>
					{/if}

					<EventForm remoteForm={createEvent} />

					<div class="flex flex-col-reverse justify-end gap-6 sm:flex-row">
						<button
							type="button"
							onclick={() => history.back()}
							class="btn disabled:bg-base-300 disabled:text-base-content"
							disabled={createEvent.pending > 0}
						>
							Abbrechen
						</button>

						<button
							type="submit"
							class="btn btn-primary disabled:bg-primary disabled:text-primary-content"
							form="event-form"
							disabled={createEvent.pending > 0}
						>
							{#if createEvent.pending === 0}
								Speichern
							{:else}
								<span class="loading loading-spinner loading-sm"></span>
								Speichere...
							{/if}
						</button>
					</div>
				</div>
			{/if}
		{:else}
			<div class="card-body gap-4 p-4 sm:p-6">
				<div>
					<p class="text-base-content/80 mt-1 text-sm">Was möchtest du erstellen?</p>
				</div>

				<div class="grid gap-4 sm:grid-cols-2">
					<a
						href={resolve(`/new?create=1`)}
						class="card bg-primary/10 transition-all hover:-translate-y-0.5 hover:shadow-md"
					>
						<div class="card-body gap-3">
							<h2 class="card-title flex items-center gap-2">
								<i class="icon-[ph--calendar-plus] size-6"></i>
								Event erstellen
							</h2>
							<p class="text-sm">
								Ein einzelner Termin, Workshop oder Circle mit Datum und Uhrzeit.
							</p>
							<div class="card-actions">
								<span class="btn btn-primary">
									Event erstellen
									<i class="icon-[ph--arrow-right] size-5"></i>
								</span>
							</div>
						</div>
					</a>

					<a
						href={routes.newOffering({ returnTo: routes.currentPath(page.url) })}
						class="card bg-secondary/15 transition-all hover:-translate-y-0.5 hover:shadow-md"
					>
						<div class="card-body gap-3">
							<h2 class="card-title flex items-center gap-2">
								<i class="icon-[ph--hand-heart] size-6"></i>
								Angebot erstellen
							</h2>
							<p class="text-sm">
								Ein dauerhaft sichtbares Angebot, das Menschen direkt anfragen können.
							</p>
							<div class="card-actions">
								<span class="btn btn-secondary">
									Angebot erstellen
									<i class="icon-[ph--arrow-right] size-5"></i>
								</span>
							</div>
						</div>
					</a>
				</div>

				<h2 class="text-base-content/70 mt-4 text-sm font-semibold tracking-wide uppercase">
					Weitere Wege
				</h2>

				<div class="card bg-info/15">
					<div class="card-body">
						<h3 class="card-title flex gap-2.5">
							<i class="icon-[ph--telegram-logo] size-7"></i>
							Telegram-Bot
						</h3>

						<div>
							Sende deinen Event an meinen Telegram-Bot.
							<br /><b> Achtung:</b>
							Beschreibung, Ort, Datum und Bild muss alles in einer Nachricht sein!
						</div>

						<div class="card-actions">
							<a
								href="https://t.me/blissbase_bot"
								target="_blank"
								rel="noopener noreferrer"
								class="btn btn-info bg-info/70 hover:bg-info"
								>Event an Telegram-Bot senden
								<i class="icon-[ph--arrow-right] size-5"></i>
							</a>
						</div>
					</div>
				</div>

				<div class="card bg-accent/30">
					<div class="card-body">
						<h3 class="card-title flex gap-2.5">
							<i class="icon-[ph--book-open] size-7"></i>
							Event Quellen
						</h3>
						Trage deinen Event in eine meiner Event Quellen ein. Ich importiere regelmäßig Events aus
						diesen Quellen. Nach etwa einem halben Tag solltest du dein Event hier sehen.

						<div class="card-actions">
							<a href={resolve(`/sources`)} class="btn btn-accent"
								>Event Quellen anzeigen <i class="icon-[ph--arrow-right] size-5"></i></a
							>
						</div>
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>
