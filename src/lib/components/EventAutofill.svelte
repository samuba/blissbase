<script lang="ts">
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import { cubicInOut } from 'svelte/easing';
	import {
		formatDateForLocalInput,
		type ContactMethod
	} from '$lib/events.remote.common';
	import { getDefaultCreateEventFieldBase } from '$lib/eventCreateDefaults';
	import { prefillEventFromDescription } from '$lib/rpc/prefillEventFromDescription.remote';
	import type { CreateEventPrefillFields } from '$lib/server/mapAiAnswerToCreateEventPrefill';

	type CreateEventForm = typeof import('$lib/rpc/eventMutations.remote').createEvent;

	let { remoteForm }: { remoteForm: CreateEventForm } = $props();

	const ALLOWED_IMAGE_TYPES = [`image/jpeg`, `image/png`, `image/webp`, `image/gif`] as const;
	const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

	const fileInputId = `event-autofill-images`;

	let isOpen = $state(false);
	let text = $state(``);
	let images = $state<AutofillImage[]>([]);
	let isPrefilling = $state(false);
	let banner = $state<{ kind: `source` | `noEvent` | `error`; text: string } | null>(null);
	let canSubmit = $derived(Boolean(text.trim()) || Boolean(images.length));
	let canAddImages = $derived(!isPrefilling && images.length < 3);

	onMount(() => {
		return () => {
			clearImages();
		};
	});

	function getDefaultCreateFields(args: { timeZone: string }) {
		return getDefaultCreateEventFieldBase({ timeZone: args.timeZone });
	}

	function getCurrentCreateFields(args: { timeZone: string }) {
		const defaults = getDefaultCreateFields({ timeZone: args.timeZone });
		return {
			...defaults,
			name: remoteForm.fields.name.value() || defaults.name,
			description: remoteForm.fields.description.value() || defaults.description,
			tagIds: (remoteForm.fields.tagIds.value() ?? defaults.tagIds).filter(
				(tagId): tagId is string => !!tagId
			),
			price: remoteForm.fields.price.value() || defaults.price,
			address: remoteForm.fields.address.value() || defaults.address,
			startAt: remoteForm.fields.startAt.value() || defaults.startAt,
			endAt: remoteForm.fields.endAt.value() || defaults.endAt,
			timeZone: remoteForm.fields.timeZone.value() || defaults.timeZone,
			isOnline: remoteForm.fields.isOnline.value() ?? defaults.isOnline,
			isNotListed: remoteForm.fields.isNotListed.value() ?? defaults.isNotListed,
			contact: remoteForm.fields.contact.value() || defaults.contact,
			contactMethod:
				(remoteForm.fields.contactMethod.value() as ContactMethod | undefined) ||
				defaults.contactMethod,
			images: (remoteForm.fields.images.value() ?? defaults.images).filter(
				(file): file is File => !!file
			)
		};
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
			endAt: prefill.endAtIso ? formatDateForLocalInput(new Date(prefill.endAtIso)) : base.endAt,
			isOnline: prefill.isOnline,
			isNotListed: prefill.isNotListed,
			contact: prefill.contact || base.contact,
			contactMethod: prefill.contactMethod || base.contactMethod
		};
	}

	async function prefillFromInput() {
		if (!canSubmit || isPrefilling) return;

		banner = null;
		isPrefilling = true;
		const timeZone =
			remoteForm.fields.timeZone.value() || Intl.DateTimeFormat().resolvedOptions().timeZone;
		const currentFields = getCurrentCreateFields({ timeZone });

		try {
			const imagePayload = await Promise.all(
				images.map(async (item) => ({
					base64: await fileToBase64(item.file),
					mediaType: item.file.type as AutofillImageMediaType
				}))
			);
			const result = await prefillEventFromDescription({
				text: text.trim(),
				timeZone,
				images: imagePayload
			});
			if (result.kind === `empty`) return;
			if (result.fields.notice === `existingSource` && result.fields.existingSource) {
				banner = {
					kind: `source`,
					text: `Die Eingabe scheint von einer bestehenden Quelle zu stammen. Wir importieren regelmäßig Events von ${result.fields.existingSource}. Der Event ist also schon bei uns gelistet oder wird es in Kürze sein.`
				};
				return;
			}
			remoteForm.fields.set(mergePrefill(currentFields, result.fields));
			if (result.fields.notice === `noEventData`) {
				banner = {
					kind: `noEvent`,
					text: `Es wurde kein klarer Event erkannt. Du kannst das Formular trotzdem ausfüllen.`
				};
				return;
			}
			text = ``;
			clearImages();
			isOpen = false;
		} catch (e) {
			console.error(e);
			banner = {
				kind: `error`,
				text: `Fehler beim automatischen Ausfüllen. Du kannst das Formular trotzdem ausfüllen.`
			};
		} finally {
			isPrefilling = false;
		}
	}

	function onImagesSelected(event: Event) {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement)) return;
		const selected = [...(input.files ?? [])];
		input.value = ``;
		if (!selected.length) return;

		const remainingSlots = Math.max(0, 3 - images.length);
		if (!remainingSlots) {
			banner = {
				kind: `error`,
				text: `Maximal 3 Bilder erlaubt.`
			};
			return;
		}

		const nextImages: AutofillImage[] = [];
		for (const file of selected.slice(0, remainingSlots)) {
			if (!ALLOWED_IMAGE_TYPES.includes(file.type as AutofillImageMediaType)) {
				banner = {
					kind: `error`,
					text: `Nur JPEG, PNG, WebP oder GIF sind erlaubt.`
				};
				continue;
			}
			if (file.size > MAX_IMAGE_BYTES) {
				banner = {
					kind: `error`,
					text: `Bilder dürfen maximal 10MB groß sein.`
				};
				continue;
			}
			nextImages.push({
				id: crypto.randomUUID(),
				file,
				previewUrl: URL.createObjectURL(file)
			});
		}
		if (!nextImages.length) return;
		banner = null;
		images = [...images, ...nextImages];
	}

	function removeImage(args: { id: string }) {
		const next = [];
		for (const item of images) {
			if (item.id === args.id) {
				URL.revokeObjectURL(item.previewUrl);
				continue;
			}
			next.push(item);
		}
		images = next;
	}

	function clearImages() {
		for (const item of images) {
			URL.revokeObjectURL(item.previewUrl);
		}
		images = [];
	}

	async function fileToBase64(file: File) {
		const buffer = await file.arrayBuffer();
		const bytes = new Uint8Array(buffer);
		let binary = ``;
		const chunkSize = 0x8000;
		for (let i = 0; i < bytes.length; i += chunkSize) {
			binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
		}
		return btoa(binary);
	}

	type AutofillImageMediaType = (typeof ALLOWED_IMAGE_TYPES)[number];
	type AutofillImage = {
		id: string;
		file: File;
		previewUrl: string;
	};
</script>

<fieldset class="fieldset w-full min-w-0 gap-3">
	<div
		class={[
			`flex w-full flex-col rounded-xl border-2 border-dashed border-primary text-primary-content sm:bg-primary/10`,
			banner?.kind === `error` ? `bg-error/10 text-error` : `bg-primary/5`
		]}
	>
		<button
			type="button"
			onclick={() => (isOpen = !isOpen)}
			class="flex h-auto min-h-0 w-full items-center justify-start gap-3 px-4 py-4 text-left normal-case"
			aria-expanded={isOpen}
		>
			<i class="icon-[ph--magic-wand] size-7 shrink-0"></i>
			<span class="flex min-w-0 flex-col items-start">
				<span class="font-semibold text-sm">Automatisch ausfüllen</span>
				<span class="text-base-content/70 text-xs font-normal">
					Text oder Flyer-Bild aus WhatsApp, Telegram & Co. nutzen
				</span>
			</span>
			<i
				class={[
					`icon-[ph--caret-down] ml-auto size-5 shrink-0 transition-transform`,
					isOpen ? `rotate-180` : ``
				]}
			></i>
		</button>

		{#if isOpen}
			<div class="flex flex-col gap-3 px-4 pb-4" transition:slide={{ duration: 250, easing: cubicInOut }}>
				<textarea
					class="textarea min-h-28 w-full font-mono text-sm"
					bind:value={text}
					disabled={isPrefilling}
					placeholder="Event Beschreibung einfügen…"
				></textarea>

				<input
					id={fileInputId}
					type="file"
					class="hidden"
					accept="image/jpeg,image/png,image/webp,image/gif"
					multiple
					disabled={!canAddImages}
					onchange={onImagesSelected}
				/>

				<div class="flex flex-wrap items-center gap-2">
					<label
						for={fileInputId}
						class={[`btn btn-sm`, !canAddImages && `btn-disabled`]}
						aria-disabled={!canAddImages}
					>
						<i class="icon-[ph--images] size-4"></i>
						Bilder aussuchen
					</label>
					<span class="text-base-content/60 text-xs">Bis zu 3 Bilder (max. 10MB)</span>
				</div>

				{#if images.length}
					<ul class="flex flex-wrap gap-2">
						{#each images as image (image.id)}
							<li class="relative size-20 overflow-hidden rounded-lg">
								<img src={image.previewUrl} alt={image.file.name} class="size-full object-cover" />
								<button
									type="button"
									class="btn btn-circle btn-xs absolute top-1 right-1"
									onclick={() => removeImage({ id: image.id })}
									disabled={isPrefilling}
									aria-label={`Bild ${image.file.name} entfernen`}
								>
									<i class="icon-[ph--x] size-3.5"></i>
								</button>
							</li>
						{/each}
					</ul>
				{/if}

				<div class="flex flex-row justify-end gap-3">
					<button
						type="button"
						class="btn"
						onclick={() => (isOpen = false)}
						disabled={isPrefilling}
					>
						Schließen
					</button>
					<button
						type="button"
						onclick={prefillFromInput}
						class="btn btn-primary disabled:bg-primary disabled:text-primary-content"
						disabled={isPrefilling || !canSubmit}
					>
						{#if isPrefilling}
							<span class="loading loading-spinner loading-sm"></span>
							Analysiere …
						{:else}
							Felder ausfüllen
							<i class="icon-[ph--sparkle] size-5"></i>
						{/if}
					</button>
				</div>

				{#if banner}
					<div
						class={[
							`alert alert-soft`,
							banner.kind === `error`
								? `alert-error`
								: banner.kind === `source`
									? `alert-warning`
									: `alert-info`
						]}
						role={banner.kind === `error` ? `alert` : `status`}
					>
						{#if banner.kind === `error`}
							<i class="icon-[ph--warning-circle] size-5 shrink-0"></i>
						{:else}
							<i class="icon-[ph--info] size-5 shrink-0"></i>
						{/if}
						<span>{banner.text}</span>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</fieldset>
