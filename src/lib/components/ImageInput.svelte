<script lang="ts">
	import type { RemoteFormField } from '@sveltejs/kit';
	import { flip } from 'svelte/animate';
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { dragHandle, dragHandleZone } from 'svelte-dnd-action';
	import PopOver from './PopOver.svelte';
	import { fade } from 'svelte/transition';

	let {
		field,
		existingImageUrlsField,
		initialExistingImageUrls = []
	}: {
		field: RemoteFormField<File[]>;
		existingImageUrlsField?: RemoteFormField<string[]>;
		initialExistingImageUrls?: string[];
	} = $props();

	let imageInputElement: HTMLInputElement | undefined;
	let dragDepth = $state(0);
	let isDesktop = $state(false);
	let isDragging = $derived(dragDepth > 0);
	let fullscreenImageUrl = $state<string | null>(null);
	let previewItems = $state<ImagePreviewItem[]>([]);
	let previewFlipDurationMs = 220;
	let objectUrlsByPreviewId = new SvelteMap<string, string>();
	let newImageOccurrenceByFingerprint = new SvelteMap<string, number>();

	onMount(() => {
		const mediaQuery = window.matchMedia(`(min-width: 640px) and (hover: hover) and (pointer: fine)`);
		const updateIsDesktop = () => {
			isDesktop = mediaQuery.matches;
		};

		updateIsDesktop();
		mediaQuery.addEventListener(`change`, updateIsDesktop);
		initializeFromFields();

		return () => {
			mediaQuery.removeEventListener(`change`, updateIsDesktop);
			revokeObjectUrls();
		};
	});

	/**
	 * Initializes previews from existing remote form values.
	 * @example
	 * initializeFromFields();
	 */
	function initializeFromFields() {
		const existingUrls = (
			existingImageUrlsField?.value()?.length ? existingImageUrlsField.value() : initialExistingImageUrls
		).filter((x) => !x.startsWith(`new:`));
		const existingPreviews = existingUrls.map((url, index) => {
			return {
				id: `existing:${index}:${url}`,
				name: `Bild #${index + 1}`,
				sizeLabel: `-`,
				url,
				source: `existing`,
				token: url
			} satisfies ImagePreviewItem;
		});

		const newFiles = field.value() ?? [];
		const newPreviews = newFiles.map((file) => createNewImagePreview({ file }));
		previewItems = [...existingPreviews, ...newPreviews];
		syncFieldsFromPreviews();
	}

	/**
	 * Builds a stable fingerprint for one uploaded file.
	 * @example
	 * const fingerprint = getFileFingerprint(file);
	 */
	function getFileFingerprint(file: File) {
		return `${file.name}-${file.lastModified}-${file.size}`;
	}

	/**
	 * Revokes object URLs used for local image previews.
	 * @example
	 * revokeObjectUrls();
	 */
	function revokeObjectUrls() {
		for (const url of objectUrlsByPreviewId.values()) {
			URL.revokeObjectURL(url);
		}
		objectUrlsByPreviewId.clear();
	}

	/**
	 * Creates a preview entry for a newly selected file.
	 * @example
	 * createNewImagePreview({ file });
	 */
	function createNewImagePreview(args: { file: File }) {
		const fingerprint = getFileFingerprint(args.file);
		const nextOccurrence = (newImageOccurrenceByFingerprint.get(fingerprint) ?? 0) + 1;
		newImageOccurrenceByFingerprint.set(fingerprint, nextOccurrence);
		const token = `new:${fingerprint}-${nextOccurrence}`;
		const previewUrl = URL.createObjectURL(args.file);
		objectUrlsByPreviewId.set(token, previewUrl);

		return {
			id: token,
			name: args.file.name,
			sizeLabel: formatFileSize(args.file.size),
			url: previewUrl,
			source: `new`,
			token,
			file: args.file
		} satisfies ImagePreviewItem;
	}

	/**
	 * Keeps remote form fields in sync with the preview order.
	 * @example
	 * syncFieldsFromPreviews();
	 */
	function syncFieldsFromPreviews() {
		const orderedNewFiles = previewItems.filter((x) => x.source === `new`).map((x) => x.file).filter((x) => !!x);
		field.set(orderedNewFiles);

		const dt = new DataTransfer();
		for (const newFile of orderedNewFiles) {
			dt.items.add(newFile);
		}
		if (imageInputElement) imageInputElement.files = dt.files;

		if (!existingImageUrlsField) return;
		existingImageUrlsField.set(previewItems.map((x) => x.token));
	}

	/**
	 * Merges newly selected image files into the current preview list.
	 * @example
	 * addSelectedImages({ files: event.currentTarget.files ?? undefined });
	 */
	function addSelectedImages(args: { files: FileList | undefined }) {
		if (!args.files?.length) return;

		const imageFiles = Array.from(args.files).filter((file) => file.type.startsWith(`image/`));
		if (!imageFiles.length) return;

		const existingCountByFingerprint = new SvelteMap<string, number>();
		for (const preview of previewItems) {
			if (preview.source !== `new` || !preview.file) continue;
			const fingerprint = getFileFingerprint(preview.file);
			existingCountByFingerprint.set(fingerprint, (existingCountByFingerprint.get(fingerprint) ?? 0) + 1);
		}

		const selectedCountByFingerprint = new SvelteMap<string, number>();
		const filesToAppend = imageFiles.filter((file) => {
			const fingerprint = getFileFingerprint(file);
			const selectedCount = (selectedCountByFingerprint.get(fingerprint) ?? 0) + 1;
			selectedCountByFingerprint.set(fingerprint, selectedCount);
			return selectedCount > (existingCountByFingerprint.get(fingerprint) ?? 0);
		});
		if (!filesToAppend.length) return;

		previewItems = [...previewItems, ...filesToAppend.map((file) => createNewImagePreview({ file }))];
		syncFieldsFromPreviews();
	}

	/**
	 * Moves a preview one position left or right and syncs the form fields.
	 * @example
	 * movePreview({ previewId: `existing:0:url`, direction: 1 });
	 */
	function movePreview(args: { previewId: string; direction: -1 | 1 }) {
		const currentIndex = previewItems.findIndex((x) => x.id === args.previewId);
		if (currentIndex < 0) return;

		const nextIndex = currentIndex + args.direction;
		if (nextIndex < 0 || nextIndex >= previewItems.length) return;

		const reorderedItems = [...previewItems];
		const [movedItem] = reorderedItems.splice(currentIndex, 1);
		if (!movedItem) return;

		reorderedItems.splice(nextIndex, 0, movedItem);
		previewItems = reorderedItems;
		syncFieldsFromPreviews();
	}

	/**
	 * Removes one selected image preview by id.
	 * @example
	 * removeSelectedImage({ previewId: `new:cover.webp-123-0` });
	 */
	function removeSelectedImage(args: { previewId: string }) {
		const preview = previewItems.find((x) => x.id === args.previewId);
		if (preview?.source === `new`) {
			const objectUrl = objectUrlsByPreviewId.get(preview.id);
			if (objectUrl) {
				URL.revokeObjectURL(objectUrl);
				objectUrlsByPreviewId.delete(preview.id);
			}
		}

		previewItems = previewItems.filter((x) => x.id !== args.previewId);
		syncFieldsFromPreviews();
	}

	/**
	 * Keeps a reference to the hidden file input element.
	 * @example
	 * <input {@attach setImageInputElement} />
	 */
	function setImageInputElement(node: HTMLInputElement) {
		imageInputElement = node;
		syncFieldsFromPreviews();

		return () => {
			imageInputElement = undefined;
		};
	}

	/**
	 * Opens the native file picker.
	 * @example
	 * openImagePicker();
	 */
	function openImagePicker() {
		imageInputElement?.click();
	}

	/**
	 * Highlights dropzone while dragging files.
	 * @example
	 * handleDragEnter();
	 */
	function handleDragEnter() {
		if (!isDesktop) return;
		dragDepth += 1;
	}

	/**
	 * Resets dropzone highlight after drag leaves.
	 * @example
	 * handleDragLeave();
	 */
	function handleDragLeave() {
		if (!isDesktop || !dragDepth) return;
		dragDepth -= 1;
	}

	/**
	 * Handles dropped files and appends image files only.
	 * @example
	 * handleDrop({ files: event.dataTransfer?.files });
	 */
	function handleDrop(args: { files: FileList | undefined }) {
		dragDepth = 0;
		if (!isDesktop) return;
		addSelectedImages({ files: args.files });
	}

	function openFullscreenPreview(url: string) {
		fullscreenImageUrl = url;
	}

	function closeFullscreenPreview() {
		fullscreenImageUrl = null;
	}

	function formatFileSize(size: number) {
		if (size < 1024) return `${size} B`;
		if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
		return `${(size / (1024 * 1024)).toFixed(1)} MB`;
	}

	type ImagePreviewItem = {
		id: string;
		name: string;
		sizeLabel: string;
		url: string;
		source: `new` | `existing`;
		token: string;
		file?: File;
	};
</script>

<fieldset class="fieldset w-full min-w-0 gap-3">
	<div
		role="group"
		aria-label="Bilder auswählen oder ablegen"
		ondragenter={handleDragEnter}
		ondragover={(event) => {
			if (!isDesktop) return;
			event.preventDefault();
		}}
		ondragleave={handleDragLeave}
		ondrop={(event) => {
			event.preventDefault();
			handleDrop({ files: event.dataTransfer?.files });
		}}
	>
		<input
			{@attach setImageInputElement}
			data-testid="image-input"
			class="sr-only"
			{...field.as('file multiple')}
			accept="image/*"
			multiple
			onchange={(event) => addSelectedImages({ files: event.currentTarget.files ?? undefined })}
		/>

		<div class="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			<div class="flex min-w-0 items-start gap-4">
				<button
					onclick={openImagePicker}
					type="button"
					class={[
						'btn  flex sm:px-6 sm:py-8 shrink-0 items-center justify-center sm:rounded-xl sm:border-dashed sm:border-primary sm:border-2',
						field.issues()?.length ? 'bg-error/10 text-error' : isDragging ? 'bg-primary' : 'sm:bg-primary/10'
					]}
				>
					<div class="flex items-center justify-center gap-2 text-primary-content">
						<i class="icon-[ph--images-square] size-7 "></i>
						<div class="text-sm">
							Bilder auswählen
							<p class="hidden sm:block">oder ablegen</p>
						</div>
					</div>
				</button>
			</div>
		</div>
	</div>

	<p class="label pt-0 wrap-break-words whitespace-pre-line">
		Lade Bilder hoch die deinen Event illustrieren.
	</p>

	<div
		data-testid="image-preview-grid"
		class:hidden={previewItems.length === 0}
		class="grid grid-cols-2 gap-3 sm:grid-cols-3"
		role="list"
		aria-label="Ausgewählte Bilder sortieren"
		use:dragHandleZone={{
			items: previewItems,
			flipDurationMs: previewFlipDurationMs,
			delayTouchStart: true,
			dropTargetStyle: { outline: `none` }
		}}
		onconsider={(event) => {
			previewItems = event.detail.items;
		}}
		onfinalize={(event) => {
			previewItems = event.detail.items;
			syncFieldsFromPreviews();
		}}
	>
		{#each previewItems as preview, i (preview.id)}
			<div
				data-testid="image-preview-item"
				animate:flip={{ duration: previewFlipDurationMs }}
				class="bg-base-200 overflow-hidden group card border border-base-300/60"
				role="listitem"
				aria-label={preview.name}
			>
				<div class="bg-base-300 relative aspect-square overflow-hidden">
					<div class="absolute top-2 left-2 badge badge-sm z-10">
						{i === 0 ? `Cover Bild` : `Bild #${i + 1}`}
					</div>
					{#if previewItems.length > 1}
						<PopOver
							triggerClass="absolute right-0 bottom-0 z-10"
							contentClass="max-w-xs py-1 bg-base-100 w-fit"
							arrowProps={{ width: 12, height: 10, class: 'text-primary' }}
						>
							{#snippet trigger()}
								<div use:dragHandle class="p-2">
									<button
										data-testid="image-preview-handle"
										type="button"
										class=" btn btn-sm rounded-lg p-1  hover:cursor-grab active:cursor-grabbing"
										aria-label={`${preview.name} verschieben`}
									>
										<i class="icon-[ph--dots-nine] size-5 drop-shadow-md"></i>
									</button>
								</div>
							{/snippet}
							{#snippet content()}
						<p class="text-xs text-center">
								Ziehe das Bild an diesem Button in eine andere Position, um die Reihenfolge zu ändern.
							</p>
							{/snippet}
						</PopOver>
					{/if}
					<button
						type="button"
						class="h-full w-full cursor-pointer"
						onclick={() => openFullscreenPreview(preview.url)}
						aria-label={`Vollbildansicht von ${preview.name} öffnen`}
					>
						<img src={preview.url} alt={`Vorschau für ${preview.name}`} class="h-full w-full object-cover" draggable="false" />
					</button>
				</div>

				<div class="flex items-start justify-between gap-2 p-3">
					<div class="min-w-0">
						<p class="truncate text-xs font-medium">{preview.name}</p>
						<p class="text-base-content/60 text-xs">{preview.sizeLabel}</p>
					</div>

					<div class="flex items-center gap-1">
						<button
							data-testid="image-preview-move-left"
							type="button"
							class="sr-only"
							aria-label={`${preview.name} nach links verschieben`}
							disabled={i === 0}
							onclick={() => movePreview({ previewId: preview.id, direction: -1 })}
						>
							Nach links
						</button>
						<button
							data-testid="image-preview-move-right"
							type="button"
							class="sr-only"
							aria-label={`${preview.name} nach rechts verschieben`}
							disabled={i === previewItems.length - 1}
							onclick={() => movePreview({ previewId: preview.id, direction: 1 })}
						>
							Nach rechts
						</button>
						<button
							data-testid="image-preview-remove"
							type="button"
							class="btn btn-ghost btn-sm btn-circle shrink-0"
							aria-label={`Bild ${preview.name} entfernen`}
							onclick={() => removeSelectedImage({ previewId: preview.id })}
						>
							<i class="icon-[ph--trash] size-5"></i>
						</button>
					</div>
				</div>
			</div>
		{/each}
	</div>

	{#if existingImageUrlsField}
		<div class="hidden">
			{#each existingImageUrlsField.value() ?? [] as token, i (`${token}-${i}`)}
				<input {...existingImageUrlsField.as('checkbox', token)} checked />
			{/each}
		</div>
	{/if}

	{#if field.issues()?.length}
		<div class="mt-2 flex flex-col gap-1">
			{#each field.issues() as issue, i (`${issue.message}-${i}`)}
				<div class="text-red-600 text-xs">{issue.message}</div>
			{/each}
		</div>
	{/if}

	{#if existingImageUrlsField?.issues()?.length}
		<div class="mt-2 flex flex-col gap-1">
			{#each existingImageUrlsField.issues() as issue, i (`${issue.message}-${i}`)}
				<div class="text-red-600 text-xs">{issue.message}</div>
			{/each}
		</div>
	{/if}

	{#if fullscreenImageUrl}
		<button
			type="button"
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
			in:fade={{ duration: 180 }}
			out:fade={{ duration: 80 }}
			onclick={closeFullscreenPreview}
			aria-label="Vollbildansicht schließen"
		>
			<img src={fullscreenImageUrl} alt="Vollbildansicht" class="max-h-full max-w-full object-contain" />
		</button>
	{/if}
</fieldset>
