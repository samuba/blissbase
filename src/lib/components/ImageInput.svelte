<script lang="ts">
	import type { RemoteFormField } from '@sveltejs/kit';
	import imageCompression from 'browser-image-compression';
	import { flip } from 'svelte/animate';
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { dragHandle, dragHandleZone } from 'svelte-dnd-action';
	import { fade } from 'svelte/transition';
	import {
		EVENT_IMAGE_MAX_DIMENSION,
		EVENT_IMAGE_MAX_SIZE_MB,
		EVENT_IMAGE_OUTPUT_MIME_TYPE,
		EVENT_IMAGE_OUTPUT_QUALITY,
		getProcessedImageFileName,
		getPerceptualHash
	} from '$lib/eventImageProcessing.shared';
	import PopOver from './PopOver.svelte';

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
	let hasProcessingInFlight = $derived(previewItems.some((x) => x.processingState === `processing`));

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
		).filter((x): x is string => typeof x === `string` && !x.startsWith(`new:`));
		const existingPreviews = existingUrls.map((url, index) => {
			return {
				id: `existing:${index}:${url}`,
				name: `Bild #${index + 1}`,
				sizeLabel: `-`,
				url,
				source: `existing`,
				token: url,
				processingState: `ready`,
				processingProgress: 100
			} satisfies ImagePreviewItem;
		});

		const newFiles = (field.value() ?? []).filter((f): f is File => f != null);
		const newPreviews = newFiles.map((file) => createReadyImagePreview({ file }));
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
	 * Replaces the object URL for one preview item.
	 * @example
	 * setObjectUrlForPreview({ previewId: `new:demo`, file });
	 */
	function setObjectUrlForPreview(args: { previewId: string; file: File }) {
		const previousUrl = objectUrlsByPreviewId.get(args.previewId);
		if (previousUrl) {
			URL.revokeObjectURL(previousUrl);
		}

		const nextUrl = URL.createObjectURL(args.file);
		objectUrlsByPreviewId.set(args.previewId, nextUrl);
		return nextUrl;
	}

	/**
	 * Creates a stable token for a newly selected image.
	 * @example
	 * const token = createNewImageToken(file);
	 */
	function createNewImageToken(file: File) {
		const fingerprint = getFileFingerprint(file);
		const nextOccurrence = (newImageOccurrenceByFingerprint.get(fingerprint) ?? 0) + 1;
		newImageOccurrenceByFingerprint.set(fingerprint, nextOccurrence);
		return `new:${fingerprint}-${nextOccurrence}`;
	}

	/**
	 * Creates a preview entry for an already processed new file.
	 * @example
	 * createReadyImagePreview({ file });
	 */
	function createReadyImagePreview(args: { file: File }) {
		const token = createNewImageToken(args.file);
		const previewUrl = setObjectUrlForPreview({ previewId: token, file: args.file });

		return {
			id: token,
			name: args.file.name,
			sizeLabel: formatFileSize(args.file.size),
			url: previewUrl,
			source: `new`,
			token,
			file: args.file,
			fingerprint: getFileFingerprint(args.file),
			processingState: `ready`,
			processingProgress: 100
		} satisfies ImagePreviewItem;
	}

	/**
	 * Creates a placeholder preview while an image is being processed.
	 * @example
	 * createPendingImagePreview({ file });
	 */
	function createPendingImagePreview(args: { file: File }) {
		const token = createNewImageToken(args.file);
		const previewUrl = setObjectUrlForPreview({ previewId: token, file: args.file });

		return {
			id: token,
			name: args.file.name,
			sizeLabel: formatFileSize(args.file.size),
			url: previewUrl,
			source: `new`,
			token,
			fingerprint: getFileFingerprint(args.file),
			processingState: `processing`,
			processingProgress: 0
		} satisfies ImagePreviewItem;
	}

	/**
	 * Returns only previews that should be submitted with the form.
	 * @example
	 * const submittedItems = getSubmittedPreviewItems();
	 */
	function getSubmittedPreviewItems() {
		return previewItems.filter((preview) => {
			if (preview.source === `existing`) return true;
			return preview.processingState === `ready` && !!preview.file;
		});
	}

	/**
	 * Keeps remote form fields in sync with the preview order.
	 * @example
	 * syncFieldsFromPreviews();
	 */
	function syncFieldsFromPreviews() {
		const orderedNewFiles = getSubmittedPreviewItems()
			.filter((x) => x.source === `new`)
			.map((x) => x.file)
			.filter((x) => !!x);
		field.set(orderedNewFiles);

		const dt = new DataTransfer();
		for (const newFile of orderedNewFiles) {
			dt.items.add(newFile);
		}
		if (imageInputElement) imageInputElement.files = dt.files;

		if (!existingImageUrlsField) return;
		existingImageUrlsField.set(getSubmittedPreviewItems().map((x) => x.token));
	}

	/**
	 * Merges newly selected image files into the current preview list.
	 * @example
	 * await addSelectedImages({ files: event.currentTarget.files ?? undefined });
	 */
	async function addSelectedImages(args: { files: FileList | undefined }) {
		if (!args.files?.length || hasProcessingInFlight) return;

		const imageFiles = Array.from(args.files).filter((file) => file.type.startsWith(`image/`));
		if (!imageFiles.length) return;

		const existingCountByFingerprint = new SvelteMap<string, number>();
		for (const preview of previewItems) {
			if (preview.source !== `new` || !preview.fingerprint) continue;
			existingCountByFingerprint.set(preview.fingerprint, (existingCountByFingerprint.get(preview.fingerprint) ?? 0) + 1);
		}

		const selectedCountByFingerprint = new SvelteMap<string, number>();
		const filesToAppend = imageFiles.filter((file) => {
			const fingerprint = getFileFingerprint(file);
			const selectedCount = (selectedCountByFingerprint.get(fingerprint) ?? 0) + 1;
			selectedCountByFingerprint.set(fingerprint, selectedCount);
			return selectedCount > (existingCountByFingerprint.get(fingerprint) ?? 0);
		});
		if (!filesToAppend.length) return;

		const pendingPreviews = filesToAppend.map((file) => ({
			file,
			preview: createPendingImagePreview({ file })
		}));
		previewItems = [...previewItems, ...pendingPreviews.map((x) => x.preview)];
		syncFieldsFromPreviews();

		for (const pendingPreview of pendingPreviews) {
			await processSelectedImage({
				previewId: pendingPreview.preview.id,
				file: pendingPreview.file
			});
		}
	}

	/**
	 * Processes one selected image into a normalized WebP upload file.
	 * @example
	 * await processSelectedImage({ previewId: `new:demo`, file });
	 */
	async function processSelectedImage(args: { previewId: string; file: File }) {
		updatePreviewProcessingState({
			previewId: args.previewId,
			processingState: `processing`,
			processingProgress: 5,
			processingError: undefined
		});

		try {
			const processedResult = await processImageFile({
				file: args.file,
				onProgress: (progress) => {
					updatePreviewProcessingState({
						previewId: args.previewId,
						processingState: `processing`,
						processingProgress: progress,
						processingError: undefined
					});
				}
			});
			const preview = previewItems.find((x) => x.id === args.previewId);
			if (!preview) return;

			const previewUrl = setObjectUrlForPreview({
				previewId: args.previewId,
				file: processedResult.file
			});

			previewItems = previewItems.map((item) => {
				if (item.id !== args.previewId) return item;
				return {
					...item,
					name: args.file.name,
					sizeLabel: formatFileSize(processedResult.file.size),
					url: previewUrl,
					file: processedResult.file,
					processingState: `ready`,
					processingProgress: 100,
					processingError: undefined
				};
			});
			syncFieldsFromPreviews();
		} catch (error) {
			updatePreviewProcessingState({
				previewId: args.previewId,
				processingState: `error`,
				processingProgress: 0,
				processingError: error instanceof Error ? error.message : `Bild konnte nicht verarbeitet werden`
			});
			syncFieldsFromPreviews();
		}
	}

	/**
	 * Updates the processing state for one preview tile.
	 * @example
	 * updatePreviewProcessingState({ previewId: `new:demo`, processingState: `processing`, processingProgress: 50 });
	 */
	function updatePreviewProcessingState(args: UpdatePreviewProcessingStateArgs) {
		previewItems = previewItems.map((item) => {
			if (item.id !== args.previewId) return item;
			return {
				...item,
				processingState: args.processingState,
				processingProgress: args.processingProgress,
				processingError: args.processingError
			};
		});
	}

	/**
	 * Converts one selected image into the normalized upload file.
	 * @example
	 * const result = await processImageFile({ file });
	 */
	async function processImageFile(args: ProcessImageFileArgs) {
		args.onProgress?.(10);
		const compressedFile = await imageCompression(args.file, {
			maxSizeMB: EVENT_IMAGE_MAX_SIZE_MB,
			maxWidthOrHeight: EVENT_IMAGE_MAX_DIMENSION,
			useWebWorker: true,
			fileType: EVENT_IMAGE_OUTPUT_MIME_TYPE,
			initialQuality: EVENT_IMAGE_OUTPUT_QUALITY,
			onProgress: (progress: number) => {
				args.onProgress?.(Math.min(70, Math.max(10, progress * 0.7)));
			}
		});
		args.onProgress?.(72);

		const outputFile = await ensureCompressedFormat({ file: compressedFile });
		args.onProgress?.(80);

		const imageData = await createImageDataFromFile({ file: outputFile });
		args.onProgress?.(92);

		const hash = getPerceptualHash({ imageData });
		const extension = outputFile.type === JPEG_FALLBACK_MIME ? `jpg` : undefined;
		const fileName = getProcessedImageFileName({
			hash,
			originalFileName: args.file.name,
			extension
		});
		const processedFile = new File([outputFile], fileName, {
			type: outputFile.type,
			lastModified: args.file.lastModified
		});

		args.onProgress?.(100);
		return {
			file: processedFile,
			hash
		} satisfies ProcessedImageResult;
	}

	const WEBP_MAGIC_BYTES = [0x52, 0x49, 0x46, 0x46];
	const JPEG_FALLBACK_MIME = `image/jpeg`;

	/**
	 * Verifies the file is actually WebP; re-encodes as JPEG if the browser
	 * silently fell back to PNG (common on older iOS Safari).
	 * @example
	 * const verified = await ensureCompressedFormat({ file: compressedFile });
	 */
	async function ensureCompressedFormat(args: { file: File }) {
		if (await isWebP({ file: args.file })) return args.file;

		const image = await loadImageFromFile({ file: args.file });
		try {
			const size = getContainedImageSize({
				width: image.naturalWidth,
				height: image.naturalHeight
			});
			const canvas = document.createElement(`canvas`);
			canvas.width = size.width;
			canvas.height = size.height;

			const ctx = canvas.getContext(`2d`);
			if (!ctx) throw new Error(`Canvas Kontext konnte nicht erstellt werden`);
			ctx.drawImage(image, 0, 0, size.width, size.height);

			const blob = await new Promise<Blob | null>((resolve) =>
				canvas.toBlob(resolve, JPEG_FALLBACK_MIME, EVENT_IMAGE_OUTPUT_QUALITY)
			);
			if (!blob) throw new Error(`JPEG-Fallback-Kodierung fehlgeschlagen`);

			return new File([blob], args.file.name.replace(/\.\w+$/, `.jpg`), {
				type: JPEG_FALLBACK_MIME,
				lastModified: args.file.lastModified
			});
		} finally {
			image.remove();
		}
	}

	/**
	 * Checks file magic bytes to detect real WebP (RIFF header).
	 * @example
	 * const ok = await isWebP({ file });
	 */
	async function isWebP(args: { file: File }) {
		if (args.file.size < 12) return false;
		const header = new Uint8Array(await args.file.slice(0, 4).arrayBuffer());
		return WEBP_MAGIC_BYTES.every((b, i) => header[i] === b);
	}

	/**
	 * Loads a browser image element from a selected file.
	 * @example
	 * const image = await loadImageFromFile({ file });
	 */
	function loadImageFromFile(args: { file: File }) {
		return new Promise<HTMLImageElement>((resolve, reject) => {
			const image = new Image();
			const objectUrl = URL.createObjectURL(args.file);

			image.onload = () => {
				URL.revokeObjectURL(objectUrl);
				resolve(image);
			};
			image.onerror = () => {
				URL.revokeObjectURL(objectUrl);
				reject(new Error(`Bild konnte nicht geladen werden`));
			};
			image.src = objectUrl;
		});
	}

	/**
	 * Calculates the final contain-fit size for one image.
	 * @example
	 * const size = getContainedImageSize({ width: 1600, height: 900 });
	 */
	function getContainedImageSize(args: { width: number; height: number }) {
		if (!args.width || !args.height) {
			throw new Error(`Bildabmessungen sind ungültig`);
		}

		const scale = Math.min(1, EVENT_IMAGE_MAX_DIMENSION / args.width, EVENT_IMAGE_MAX_DIMENSION / args.height);
		return {
			width: Math.max(1, Math.round(args.width * scale)),
			height: Math.max(1, Math.round(args.height * scale))
		};
	}

	/**
	 * Creates image data from a processed file for perceptual hashing.
	 * @example
	 * const imageData = await createImageDataFromFile({ file });
	 */
	async function createImageDataFromFile(args: { file: File }) {
		const image = await loadImageFromFile({ file: args.file });

		try {
			const size = getContainedImageSize({
				width: image.naturalWidth,
				height: image.naturalHeight
			});
			const canvas = document.createElement(`canvas`);
			canvas.width = size.width;
			canvas.height = size.height;

			const context = canvas.getContext(`2d`);
			if (!context) throw new Error(`Canvas Kontext konnte nicht erstellt werden`);

			context.drawImage(image, 0, 0, size.width, size.height);
			return context.getImageData(0, 0, size.width, size.height);
		} finally {
			image.remove();
		}
	}

	/**
	 * Moves a preview one position left or right and syncs the form fields.
	 * @example
	 * movePreview({ previewId: `existing:0:url`, direction: 1 });
	 */
	function movePreview(args: { previewId: string; direction: -1 | 1 }) {
		if (hasProcessingInFlight) return;
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
		const objectUrl = objectUrlsByPreviewId.get(args.previewId);
		if (objectUrl) {
			URL.revokeObjectURL(objectUrl);
			objectUrlsByPreviewId.delete(args.previewId);
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
		if (hasProcessingInFlight) return;
		imageInputElement?.click();
	}

	/**
	 * Highlights dropzone while dragging files.
	 * @example
	 * handleDragEnter();
	 */
	function handleDragEnter() {
		if (!isDesktop || hasProcessingInFlight) return;
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
	 * await handleDrop({ files: event.dataTransfer?.files });
	 */
	async function handleDrop(args: { files: FileList | undefined }) {
		dragDepth = 0;
		if (!isDesktop || hasProcessingInFlight) return;
		await addSelectedImages({ files: args.files });
	}

	/**
	 * Opens the full-screen preview modal.
	 * @example
	 * openFullscreenPreview(`https://example.com/image.webp`);
	 */
	function openFullscreenPreview(url: string) {
		fullscreenImageUrl = url;
	}

	/**
	 * Closes the full-screen preview modal.
	 * @example
	 * closeFullscreenPreview();
	 */
	function closeFullscreenPreview() {
		fullscreenImageUrl = null;
	}

	/**
	 * Formats a byte size for the preview metadata.
	 * @example
	 * formatFileSize(1536);
	 */
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
		fingerprint?: string;
		processingState: ProcessingState;
		processingProgress: number;
		processingError?: string;
	};

	type UpdatePreviewProcessingStateArgs = {
		previewId: string;
		processingState: ProcessingState;
		processingProgress: number;
		processingError?: string;
	};

	type ProcessImageFileArgs = {
		file: File;
		onProgress?: (progress: number) => void;
	};

	type ProcessedImageResult = {
		file: File;
		hash: string;
	};

	type ProcessingState = `ready` | `processing` | `error`;
</script>

<fieldset class="fieldset w-full min-w-0 gap-3">
	<div
		role="group"
		aria-label="Bilder auswählen oder ablegen"
		ondragenter={handleDragEnter}
		ondragover={(event) => {
			if (!isDesktop || hasProcessingInFlight) return;
			event.preventDefault();
		}}
		ondragleave={handleDragLeave}
		ondrop={async (event) => {
			event.preventDefault();
			await handleDrop({ files: event.dataTransfer?.files });
		}}
	>
		<input
			{@attach setImageInputElement}
			data-testid="image-input"
			class="sr-only"
			{...field.as('file multiple')}
			accept="image/*"
			multiple
			disabled={hasProcessingInFlight}
			onchange={async (event) => {
				await addSelectedImages({ files: event.currentTarget.files ?? undefined });
			}}
		/>

		<div class="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			<div class="flex min-w-0 items-start gap-4">
				<button
					onclick={openImagePicker}
					type="button"
					disabled={hasProcessingInFlight}
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
		{#if hasProcessingInFlight}
			\nBilder werden vor dem Upload lokal verarbeitet.
		{/if}
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
			dragDisabled: hasProcessingInFlight,
			dropTargetStyle: { outline: `none` }
		}}
		onconsider={(event) => {
			if (hasProcessingInFlight) return;
			previewItems = event.detail.items;
		}}
		onfinalize={(event) => {
			if (hasProcessingInFlight) return;
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
							{#snippet trigger({ props })}
								<div
									use:dragHandle
									{...props}
									class={[`p-2`, props.class]}
								>
									<button
										data-testid="image-preview-handle"
										type="button"
										class=" btn btn-sm rounded-lg p-1  hover:cursor-grab active:cursor-grabbing"
										aria-label={`${preview.name} verschieben`}
										disabled={hasProcessingInFlight}
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
					{#if preview.processingState !== `ready`}
						<div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 p-3 text-center backdrop-brightness-75 text-white backdrop-blur-[2px]">
							{#if preview.processingState === `error`}
								<div class="">
									<i class="icon-[ph--warning-circle] size-8 text-error"></i>
									<p class="text-xs font-medium">Verarbeitung fehlgeschlagen</p>
									<p class="text-[11px] opacity-80">{preview.processingError}</p>
								</div>
							{:else}
								<div class="">
									<i class="loading loading-spinner loading-xl"></i>
									<p class="text-xs font-medium">Wird verarbeitet</p>
									<p class="text-[11px] opacity-80">{Math.round(preview.processingProgress)}%</p>
								</div>
							{/if}
						</div>
						{#if preview.processingState === `processing`}
							<div
								class="absolute bottom-0 left-0 z-10 h-1.5 bg-primary transition-all duration-300"
								style:width={`${preview.processingProgress}%`}
							></div>
						{/if}
					{/if}
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
							disabled={i === 0 || hasProcessingInFlight}
							onmousedown={(e) => e.stopPropagation()}
							onclick={(e) => {
								e.stopPropagation();
								movePreview({ previewId: preview.id, direction: -1 });
							}}
						>
							Nach links
						</button>
						<button
							data-testid="image-preview-move-right"
							type="button"
							class="sr-only"
							aria-label={`${preview.name} nach rechts verschieben`}
							disabled={i === previewItems.length - 1 || hasProcessingInFlight}
							onmousedown={(e) => e.stopPropagation()}
							onclick={(e) => {
								e.stopPropagation();
								movePreview({ previewId: preview.id, direction: 1 });
							}}
						>
							Nach rechts
						</button>
						<button
							data-testid="image-preview-remove"
							type="button"
							class="btn btn-ghost btn-sm btn-circle shrink-0"
							aria-label={`Bild ${preview.name} entfernen`}
							onmousedown={(e) => e.stopPropagation()}
							onclick={(e) => {
								e.stopPropagation();
								removeSelectedImage({ previewId: preview.id });
							}}
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
			{#each (existingImageUrlsField.value() ?? []).filter((t): t is string => Boolean(t)) as token, i (`${token}-${i}`)}
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
			class="fixed inset-0 z-70 flex items-center justify-center bg-black/85 p-4"
			in:fade={{ duration: 180 }}
			out:fade={{ duration: 80 }}
			onclick={closeFullscreenPreview}
			aria-label="Vollbildansicht schließen"
		>
			<img src={fullscreenImageUrl} alt="Vollbildansicht" class="max-h-full max-w-full object-contain" />
		</button>
	{/if}
</fieldset>
