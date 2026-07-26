<script lang="ts">
	import type { RemoteFormField } from "@sveltejs/kit";
	import { flip } from "svelte/animate";
	import { onMount } from "svelte";
	import { SvelteMap } from "svelte/reactivity";
	import { dragHandle, dragHandleZone } from "svelte-dnd-action";
	import { fade } from "svelte/transition";
	import { processImageUploadFile } from "$lib/imageUpload";
	import { OFFERING_IMAGE_MAX_COUNT } from "$lib/rpc/offerings.common";
	import { createOfferingImageUploadUrl } from "$lib/rpc/offerings.remote";
	import PopOver from "./PopOver.svelte";

	let {
		field,
		existingImageUrlsField,
		imageOrderField,
		initialExistingImageUrls = [],
		onBusyChange,
		onDirty,
		class: className,
	}: {
		field: RemoteFormField<string[]>;
		existingImageUrlsField?: RemoteFormField<string[]>;
		imageOrderField?: RemoteFormField<string[]>;
		initialExistingImageUrls?: string[];
		onBusyChange?: (busy: boolean) => void;
		onDirty?: () => void;
		class?: string;
	} = $props();

	let imageInputElement = $state<HTMLInputElement | undefined>();
	let dragDepth = $state(0);
	let isDesktop = $state(false);
	let isDragging = $derived(dragDepth > 0);
	let fullscreenImageUrl = $state<string | null>(null);
	let hasInitializedPreviews = $state(false);
	let previewItems = $state<OfferingImagePreviewItem[]>([]);
	let objectUrlsByPreviewId = new SvelteMap<string, string>();
	let newImageOccurrenceByFingerprint = new SvelteMap<string, number>();
	let lastReportedBusy = false;
	const previewFlipDurationMs = 220;
	const busy = $derived(previewItems.some((x) => x.uploadState === `processing` || x.uploadState === `uploading`));
	const submittedExistingImageUrls = $derived(
		previewItems.filter((preview) => preview.source === `existing`).map((preview) => preview.url),
	);
	const submittedClaimTokens = $derived(
		previewItems
			.filter((preview) => preview.source === `new` && preview.uploadState === `ready` && preview.claimToken)
			.map((preview) => preview.claimToken)
			.filter((token): token is string => Boolean(token)),
	);
	const submittedImageOrder = $derived.by(() => {
		return previewItems
			.map((preview) => {
				if (preview.source === `existing`) return preview.url;
				if (preview.uploadState === `ready` && preview.claimToken) return preview.claimToken;
				return undefined;
			})
			.filter((value): value is string => Boolean(value));
	});

	onMount(() => {
		const mediaQuery = window.matchMedia(`(min-width: 640px) and (hover: hover) and (pointer: fine)`);
		const updateIsDesktop = () => {
			isDesktop = mediaQuery.matches;
		};

		updateIsDesktop();
		mediaQuery.addEventListener(`change`, updateIsDesktop);
		initializeExistingPreviews();

		return () => {
			mediaQuery.removeEventListener(`change`, updateIsDesktop);
			revokeObjectUrls();
			reportBusy(false);
		};
	});

	function reportBusy(nextBusy: boolean) {
		if (lastReportedBusy === nextBusy) return;
		lastReportedBusy = nextBusy;
		onBusyChange?.(nextBusy);
	}

	/**
	 * Initializes edit previews from existing image URLs once the form is mounted.
	 * @example
	 * initializeExistingPreviews();
	 */
	function initializeExistingPreviews() {
		const fieldUrls = (existingImageUrlsField?.value() ?? []).filter((url): url is string => Boolean(url));
		const existingUrls = (fieldUrls.length ? fieldUrls : initialExistingImageUrls).filter((url): url is string => Boolean(url));
		if (!existingUrls.length) {
			hasInitializedPreviews = true;
			return;
		}

		const existingPreviews = existingUrls.map((url, index) => {
			return {
				id: `existing:${url}`,
				name: `Bild #${index + 1}`,
				sizeLabel: `Bereits hochgeladen`,
				url,
				source: `existing`,
				uploadState: `ready`,
				progress: 100,
			} satisfies OfferingImagePreviewItem;
		});
		previewItems = [...existingPreviews, ...previewItems];
		hasInitializedPreviews = true;
	}

	/**
	 * Builds a stable fingerprint for one selected file.
	 * @example
	 * const fingerprint = getFileFingerprint(file);
	 */
	function getFileFingerprint(file: File) {
		return `${file.name}-${file.lastModified}-${file.size}`;
	}

	/**
	 * Revokes all local object URLs owned by this component.
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
	 * Replaces one local preview URL and revokes the previous one.
	 * @example
	 * const previewUrl = setObjectUrlForPreview({ previewId: `new:1`, file });
	 */
	function setObjectUrlForPreview(args: { previewId: string; file: File | Blob }) {
		const previousUrl = objectUrlsByPreviewId.get(args.previewId);
		if (previousUrl) URL.revokeObjectURL(previousUrl);

		const nextUrl = URL.createObjectURL(args.file);
		objectUrlsByPreviewId.set(args.previewId, nextUrl);
		return nextUrl;
	}

	/**
	 * Releases the local object URL for one preview after a public URL is available.
	 * @example
	 * clearObjectUrlForPreview(`new:1`);
	 */
	function clearObjectUrlForPreview(previewId: string) {
		const objectUrl = objectUrlsByPreviewId.get(previewId);
		if (!objectUrl) return;
		URL.revokeObjectURL(objectUrl);
		objectUrlsByPreviewId.delete(previewId);
	}

	/**
	 * Creates a unique preview token for a newly selected image.
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
	 * Creates a local preview entry while processing and upload are pending.
	 * @example
	 * const preview = createPendingImagePreview({ file });
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
			fingerprint: getFileFingerprint(args.file),
			uploadState: `processing`,
			progress: 0,
		} satisfies OfferingImagePreviewItem;
	}

	/**
	 * Merges selected image files and starts processing/uploading them.
	 * @example
	 * await addSelectedImages({ files: input.files ?? undefined });
	 */
	async function addSelectedImages(args: { files: FileList | undefined }) {
		if (!args.files?.length || busy) return;

		const imageFiles = Array.from(args.files).filter((file) => file.type.startsWith(`image/`));
		if (!imageFiles.length) return;

		const remainingSlots = Math.max(0, OFFERING_IMAGE_MAX_COUNT - previewItems.length);
		if (!remainingSlots) return;

		const existingCountByFingerprint = new SvelteMap<string, number>();
		for (const preview of previewItems) {
			if (preview.source !== `new`) continue;
			if (!preview.fingerprint) continue;
			existingCountByFingerprint.set(preview.fingerprint, (existingCountByFingerprint.get(preview.fingerprint) ?? 0) + 1);
		}

		const selectedCountByFingerprint = new SvelteMap<string, number>();
		const filesToAppend = imageFiles
			.filter((file) => {
				const fingerprint = getFileFingerprint(file);
				const selectedCount = (selectedCountByFingerprint.get(fingerprint) ?? 0) + 1;
				selectedCountByFingerprint.set(fingerprint, selectedCount);
				return selectedCount > (existingCountByFingerprint.get(fingerprint) ?? 0);
			})
			.slice(0, remainingSlots);
		if (!filesToAppend.length) return;

		const pendingPreviews = filesToAppend.map((file) => ({
			file,
			preview: createPendingImagePreview({ file }),
		}));
		previewItems = [...previewItems, ...pendingPreviews.map((x) => x.preview)];
		onDirty?.();
		reportBusy(true);

		for (const pendingPreview of pendingPreviews) {
			await processAndUploadSelectedImage({
				previewId: pendingPreview.preview.id,
				file: pendingPreview.file,
			});
		}
	}

	/**
	 * Processes one image locally, uploads it directly, and stores its claim token.
	 * @example
	 * await processAndUploadSelectedImage({ previewId: `new:1`, file });
	 */
	async function processAndUploadSelectedImage(args: { previewId: string; file: File }) {
		updatePreviewState({
			previewId: args.previewId,
			uploadState: `processing`,
			progress: 5,
			error: undefined,
		});

		try {
			const processedFile = await processImageUploadFile({
				file: args.file,
				onProgress: (progress) => {
					updatePreviewState({
						previewId: args.previewId,
						uploadState: `processing`,
						progress: Math.min(80, progress * 0.8),
						error: undefined,
					});
				},
			});

			const previewUrl = setObjectUrlForPreview({
				previewId: args.previewId,
				file: processedFile,
			});
			updatePreviewState({
				previewId: args.previewId,
				uploadState: `uploading`,
				progress: 82,
				url: previewUrl,
				name: args.file.name,
				sizeLabel: formatFileSize(processedFile.size),
				error: undefined,
			});

			const { uploadUrl, publicUrl, claimToken } = await createOfferingImageUploadUrl({
				contentType: getUploadContentType(processedFile),
			});

			const response = await fetch(uploadUrl, {
				method: `PUT`,
				body: processedFile,
				headers: { "Content-Type": processedFile.type },
			});
			if (!response.ok) {
				throw new Error(`Upload fehlgeschlagen (HTTP ${response.status})`);
			}

			clearObjectUrlForPreview(args.previewId);
			updatePreviewState({
				previewId: args.previewId,
				uploadState: `ready`,
				progress: 100,
				url: publicUrl,
				claimToken,
				error: undefined,
			});
		} catch (error) {
			updatePreviewState({
				previewId: args.previewId,
				uploadState: `error`,
				progress: 0,
				error: error instanceof Error ? error.message : `Bild konnte nicht hochgeladen werden`,
			});
		}
	}

	/**
	 * Updates one preview item without disturbing the current order.
	 * @example
	 * updatePreviewState({ previewId: `new:1`, uploadState: `ready`, progress: 100 });
	 */
	function updatePreviewState(args: UpdatePreviewStateArgs) {
		previewItems = previewItems.map((item) => {
			if (item.id !== args.previewId) return item;
			return {
				...item,
				name: args.name ?? item.name,
				sizeLabel: args.sizeLabel ?? item.sizeLabel,
				url: args.url ?? item.url,
				claimToken: args.claimToken ?? item.claimToken,
				uploadState: args.uploadState,
				progress: args.progress,
				error: args.error,
			};
		});
		reportBusy(busy);
	}

	/**
	 * Narrows a processed image type to one supported by the upload command.
	 * @example
	 * const contentType = getUploadContentType(file);
	 */
	function getUploadContentType(file: File): OfferingImageContentType {
		if (file.type === `image/webp`) return `image/webp`;
		return `image/jpeg`;
	}

	/**
	 * Moves a preview one position left or right and syncs via derived claim order.
	 * @example
	 * movePreview({ previewId: `new:1`, direction: 1 });
	 */
	function movePreview(args: { previewId: string; direction: -1 | 1 }) {
		if (busy) return;
		const currentIndex = previewItems.findIndex((x) => x.id === args.previewId);
		if (currentIndex < 0) return;

		const nextIndex = currentIndex + args.direction;
		if (nextIndex < 0 || nextIndex >= previewItems.length) return;

		const reorderedItems = [...previewItems];
		const [movedItem] = reorderedItems.splice(currentIndex, 1);
		if (!movedItem) return;

		reorderedItems.splice(nextIndex, 0, movedItem);
		previewItems = reorderedItems;
		onDirty?.();
	}

	/**
	 * Removes one selected image from previews and submitted claims.
	 * @example
	 * removeSelectedImage({ previewId: `new:1` });
	 */
	function removeSelectedImage(args: { previewId: string }) {
		if (busy) return;
		clearObjectUrlForPreview(args.previewId);
		previewItems = previewItems.filter((x) => x.id !== args.previewId);
		onDirty?.();
	}

	/**
	 * Opens the native image picker.
	 * @example
	 * openImagePicker();
	 */
	function openImagePicker() {
		if (busy) return;
		imageInputElement?.click();
	}

	/**
	 * Highlights the dropzone while files are being dragged over it.
	 * @example
	 * handleDragEnter();
	 */
	function handleDragEnter() {
		if (!isDesktop || busy) return;
		dragDepth += 1;
	}

	/**
	 * Resets the dropzone highlight after dragging leaves.
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
		if (!isDesktop || busy) return;
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
	 * Formats a byte size for preview metadata.
	 * @example
	 * formatFileSize(1536);
	 */
	function formatFileSize(size: number) {
		if (size < 1024) return `${size} B`;
		if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
		return `${(size / (1024 * 1024)).toFixed(1)} MB`;
	}

	type OfferingImagePreviewItem = {
		id: string;
		name: string;
		sizeLabel: string;
		url: string;
		source: `existing` | `new`;
		fingerprint?: string;
		uploadState: UploadState;
		progress: number;
		claimToken?: string;
		error?: string;
	};

	type UpdatePreviewStateArgs = {
		previewId: string;
		uploadState: UploadState;
		progress: number;
		name?: string;
		sizeLabel?: string;
		url?: string;
		claimToken?: string;
		error?: string;
	};

	type UploadState = `ready` | `processing` | `uploading` | `error`;
	type OfferingImageContentType = `image/webp` | `image/jpeg`;
</script>

<fieldset class={[`fieldset w-full min-w-0 gap-3`, className]}>
	<legend class="fieldset-legend peer-aria-invalid:text-red-600">Bilder</legend>

	<div
		role="group"
		aria-label="Bilder auswählen oder ablegen"
		ondragenter={handleDragEnter}
		ondragover={(event) => {
			if (!isDesktop || busy) return;
			event.preventDefault();
		}}
		ondragleave={handleDragLeave}
		ondrop={async (event) => {
			event.preventDefault();
			await handleDrop({ files: event.dataTransfer?.files });
		}}
	>
		<input
			bind:this={imageInputElement}
			data-testid="offering-image-input"
			class="sr-only"
			type="file"
			accept="image/*"
			multiple
			disabled={busy}
			onchange={async (event) => {
				const input = event.currentTarget;
				await addSelectedImages({ files: input.files ?? undefined });
				input.value = ``;
			}}
		/>

		<div class="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			<button
				onclick={openImagePicker}
				type="button"
				disabled={busy || previewItems.length >= OFFERING_IMAGE_MAX_COUNT}
				class={[
					"btn sm:border-primary flex shrink-0 items-center justify-center sm:rounded-xl sm:border-2 sm:border-dashed sm:px-6 sm:py-8",
					field.issues()?.length ? "bg-error/10 text-error" : isDragging ? "bg-primary" : "sm:bg-primary/10",
				]}
			>
				<div class="text-primary-content flex items-center justify-center gap-2">
					<i class="icon-[ph--images-square] size-7"></i>
					<div class="text-sm">
						Bilder auswählen
						<p class="hidden sm:block">oder ablegen</p>
					</div>
				</div>
			</button>
		</div>
	</div>

	<p class="label pt-0 whitespace-pre-line">
		Lade Bilder hoch, die dein Angebot zeigen. Das erste Bild wird als Cover verwendet.
		{#if busy}
			<br />Bilder werden lokal verarbeitet und hochgeladen.
		{/if}
	</p>

	<div
		data-testid="offering-image-preview-grid"
		class:hidden={previewItems.length === 0}
		class="grid grid-cols-2 gap-3 sm:grid-cols-3"
		role="list"
		aria-label="Ausgewählte Bilder sortieren"
		use:dragHandleZone={{
			items: previewItems,
			flipDurationMs: previewFlipDurationMs,
			delayTouchStart: true,
			dragDisabled: busy,
			dropTargetStyle: { outline: `none` },
		}}
		onconsider={(event) => {
			if (busy) return;
			previewItems = event.detail.items;
		}}
		onfinalize={(event) => {
			if (busy) return;
			previewItems = event.detail.items;
			onDirty?.();
		}}
	>
		{#each previewItems as preview, i (preview.id)}
			<div
				data-testid="offering-image-preview-item"
				animate:flip={{ duration: previewFlipDurationMs }}
				class="bg-base-200 group card border-base-300/60 overflow-hidden border"
				role="listitem"
				aria-label={preview.name}
			>
				<div class="bg-base-300 relative aspect-square overflow-hidden">
					<div class="badge badge-sm absolute top-2 left-2 z-10">
						{i === 0 ? `Cover Bild` : `Bild #${i + 1}`}
					</div>
					{#if previewItems.length > 1}
						<PopOver
							triggerClass="absolute right-0 bottom-0 z-10"
							contentClass="max-w-xs py-1 bg-base-100 w-fit"
							arrowProps={{ width: 12, height: 10, class: "text-primary" }}
						>
							{#snippet trigger({ props })}
								<div use:dragHandle {...props} class={[`p-2`, props.class]}>
									<button
										data-testid="offering-image-preview-handle"
										type="button"
										class="btn btn-sm rounded-lg p-1 hover:cursor-grab active:cursor-grabbing"
										aria-label={`${preview.name} verschieben`}
										disabled={busy}
									>
										<i class="icon-[ph--dots-nine] size-5 drop-shadow-md"></i>
									</button>
								</div>
							{/snippet}
							{#snippet content()}
								<p class="text-center text-xs">Ziehe das Bild an diesem Button in eine andere Position, um die Reihenfolge zu ändern.</p>
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
					{#if preview.uploadState !== `ready`}
						<div
							class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 p-3 text-center text-white backdrop-blur-[2px] backdrop-brightness-75"
						>
							{#if preview.uploadState === `error`}
								<div>
									<i class="icon-[ph--warning-circle] text-error size-8"></i>
									<p class="text-xs font-medium">Upload fehlgeschlagen</p>
									<p class="text-[11px] opacity-80">{preview.error}</p>
								</div>
							{:else}
								<div>
									<i class="loading loading-spinner loading-xl"></i>
									<p class="text-xs font-medium">
										{preview.uploadState === `processing` ? `Wird verarbeitet` : `Wird hochgeladen`}
									</p>
									<p class="text-[11px] opacity-80">{Math.round(preview.progress)}%</p>
								</div>
							{/if}
						</div>
						{#if preview.uploadState === `processing` || preview.uploadState === `uploading`}
							<div
								class="bg-primary absolute bottom-0 left-0 z-10 h-1.5 transition-all duration-300"
								style:width={`${preview.progress}%`}
							></div>
						{/if}
					{/if}
				</div>

				<div class="flex items-start justify-between gap-2 p-3">
					<div class="min-w-0">
						<p class="truncate text-xs font-medium">{preview.name}</p>
						<p class="text-base-content/60 text-xs">{preview.sizeLabel}</p>
					</div>

					<div class="relative flex items-center gap-1">
						<button
							data-testid="offering-image-preview-move-left"
							type="button"
							class="sr-only top-0 left-0 z-20"
							aria-label={`${preview.name} nach links verschieben`}
							disabled={i === 0 || busy}
							onmousedown={(e) => e.stopPropagation()}
							onclick={(e) => {
								e.stopPropagation();
								movePreview({ previewId: preview.id, direction: -1 });
							}}
						>
							Nach links
						</button>
						<button
							data-testid="offering-image-preview-move-right"
							type="button"
							class="sr-only top-0 left-1 z-20"
							aria-label={`${preview.name} nach rechts verschieben`}
							disabled={i === previewItems.length - 1 || busy}
							onmousedown={(e) => e.stopPropagation()}
							onclick={(e) => {
								e.stopPropagation();
								movePreview({ previewId: preview.id, direction: 1 });
							}}
						>
							Nach rechts
						</button>
						<button
							data-testid="offering-image-preview-remove"
							type="button"
							class="btn btn-ghost btn-sm btn-circle shrink-0"
							aria-label={`Bild ${preview.name} entfernen`}
							disabled={busy}
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

	<div class="hidden">
		{#if existingImageUrlsField}
			{#each submittedExistingImageUrls as url, i (`${url}-${i}`)}
				<input {...existingImageUrlsField.as(`checkbox`, url)} checked />
			{/each}
		{/if}
		{#if imageOrderField}
			{#each submittedImageOrder as value, i (`${value}-${i}`)}
				<input {...imageOrderField.as(`checkbox`, value)} checked />
			{/each}
		{/if}
		{#each submittedClaimTokens as token, i (`${token}-${i}`)}
			<input {...field.as(`checkbox`, token)} checked />
		{/each}
	</div>

	{#if field.issues()?.length}
		<div class="mt-2 flex flex-col gap-1">
			{#each field.issues() as issue, i (`${issue.message}-${i}`)}
				<div class="text-xs text-red-600">{issue.message}</div>
			{/each}
		</div>
	{/if}

	{#if existingImageUrlsField?.issues()?.length}
		<div class="mt-2 flex flex-col gap-1">
			{#each existingImageUrlsField.issues() as issue, i (`${issue.message}-${i}`)}
				<div class="text-xs text-red-600">{issue.message}</div>
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
