<script lang="ts">
	import type { RemoteFormField } from "@sveltejs/kit";
	import { flip } from "svelte/animate";
	import { onMount } from "svelte";
	import { SvelteMap } from "svelte/reactivity";
	import { dragHandle, dragHandleZone } from "svelte-dnd-action";
	import { fade } from "svelte/transition";
	import { processImageUploadFile } from "$lib/imageUpload";
	import {
		GALLERY_IMAGE_MAX_COUNT,
		getOrderedGalleryPreviewEntries,
		publicUrlFromImageClaim,
		type GalleryImageKind,
	} from "$lib/galleryImages";
	import { createGalleryImageUploadUrl, discardGalleryImage } from "$lib/rpc/galleryImages.remote";
	import PopOver from "./PopOver.svelte";

	let {
		kind,
		field,
		existingImageUrlsField,
		imageOrderField,
		initialExistingImageUrls = [],
		hint,
		testIdPrefix,
		onBusyChange,
		onFailedChange,
		onDirty,
		class: className,
	}: {
		kind: GalleryImageKind;
		field: RemoteFormField<string[]>;
		existingImageUrlsField?: RemoteFormField<string[]>;
		imageOrderField?: RemoteFormField<string[]>;
		initialExistingImageUrls?: string[];
		hint: string;
		testIdPrefix: string;
		onBusyChange?: (busy: boolean) => void;
		onFailedChange?: (failed: boolean) => void;
		onDirty?: () => void;
		class?: string;
	} = $props();

	let imageInputElement = $state<HTMLInputElement | undefined>();
	let dragDepth = $state(0);
	let isDesktop = $state(false);
	let isDragging = $derived(dragDepth > 0);
	let fullscreenImageUrl = $state<string | null>(null);
	let previewItems = $state<GalleryImagePreviewItem[]>(createPreviewItemsFromFields());
	let objectUrlsByPreviewId = new SvelteMap<string, string>();
	let newImageOccurrenceByFingerprint = new SvelteMap<string, number>();
	let cancelledPreviewIds = new Set<string>();
	let lastReportedBusy = false;
	let lastReportedFailed = false;
	const previewFlipDurationMs = 220;
	const readyOrBusyCount = $derived((previewItems ?? []).filter((x) => x.uploadState !== `error`).length);
	const atMaxCount = $derived(readyOrBusyCount >= GALLERY_IMAGE_MAX_COUNT);
	const busy = $derived((previewItems ?? []).some((x) => x.uploadState === `processing` || x.uploadState === `uploading`));
	const hasFailedUploads = $derived((previewItems ?? []).some((x) => x.uploadState === `error`));
	const submittedExistingImageUrls = $derived(
		(previewItems ?? []).filter((preview) => preview.source === `existing`).map((preview) => preview.url),
	);
	const submittedClaimTokens = $derived(
		(previewItems ?? [])
			.filter((preview) => preview.source === `new` && preview.uploadState === `ready` && preview.claimToken)
			.map((preview) => preview.claimToken)
			.filter((token): token is string => Boolean(token)),
	);
	const submittedImageOrder = $derived.by(() => {
		return (previewItems ?? [])
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
		previewItems = createPreviewItemsFromFields();

		return () => {
			mediaQuery.removeEventListener(`change`, updateIsDesktop);
			revokeObjectUrls();
			reportBusy(false);
			reportFailed(false);
		};
	});

	function testId(suffix: string) {
		return `${testIdPrefix}-${suffix}`;
	}

	function reportBusy(nextBusy: boolean) {
		if (lastReportedBusy === nextBusy) return;
		lastReportedBusy = nextBusy;
		onBusyChange?.(nextBusy);
	}

	function reportFailed(nextFailed: boolean) {
		if (lastReportedFailed === nextFailed) return;
		lastReportedFailed = nextFailed;
		onFailedChange?.(nextFailed);
	}

	function createPreviewItemsFromFields() {
		const fieldUrls = (existingImageUrlsField?.value() ?? []).filter((url): url is string => Boolean(url));
		const existingUrls = (fieldUrls.length ? fieldUrls : initialExistingImageUrls).filter((url): url is string => Boolean(url));
		const claimTokens = (field.value() ?? []).filter((token): token is string => Boolean(token));
		const imageOrder = (imageOrderField?.value() ?? []).filter((token): token is string => Boolean(token));

		return getOrderedGalleryPreviewEntries({ existingUrls, claimTokens, imageOrder }).map((entry, index) => {
			if (entry.source === `existing`) {
				return {
					id: `existing:${entry.url}`,
					name: ``,
					sizeLabel: ``,
					url: entry.url,
					source: `existing`,
					uploadState: `ready`,
					progress: 100,
				} satisfies GalleryImagePreviewItem;
			}

			return {
				id: `claim:${index}:${entry.claimToken}`,
				name: ``,
				sizeLabel: ``,
				url: publicUrlFromImageClaim(entry.claimToken),
				source: `new`,
				claimToken: entry.claimToken,
				uploadState: `ready`,
				progress: 100,
			} satisfies GalleryImagePreviewItem;
		});
	}

	function getFileFingerprint(file: File) {
		return `${file.name}-${file.lastModified}-${file.size}`;
	}

	function revokeObjectUrls() {
		for (const url of objectUrlsByPreviewId.values()) {
			URL.revokeObjectURL(url);
		}
		objectUrlsByPreviewId.clear();
	}

	function setObjectUrlForPreview(args: { previewId: string; file: File | Blob }) {
		const previousUrl = objectUrlsByPreviewId.get(args.previewId);
		if (previousUrl) URL.revokeObjectURL(previousUrl);

		const nextUrl = URL.createObjectURL(args.file);
		objectUrlsByPreviewId.set(args.previewId, nextUrl);
		return nextUrl;
	}

	function clearObjectUrlForPreview(previewId: string) {
		const objectUrl = objectUrlsByPreviewId.get(previewId);
		if (!objectUrl) return;
		URL.revokeObjectURL(objectUrl);
		objectUrlsByPreviewId.delete(previewId);
	}

	function createNewImageToken(file: File) {
		const fingerprint = getFileFingerprint(file);
		const nextOccurrence = (newImageOccurrenceByFingerprint.get(fingerprint) ?? 0) + 1;
		newImageOccurrenceByFingerprint.set(fingerprint, nextOccurrence);
		return `new:${fingerprint}-${nextOccurrence}`;
	}

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
			sourceFile: args.file,
			uploadState: `processing`,
			progress: 0,
		} satisfies GalleryImagePreviewItem;
	}

	function isCancelled(previewId: string) {
		return cancelledPreviewIds.has(previewId) || !previewItems.some((item) => item.id === previewId);
	}

	async function addSelectedImages(args: { files: FileList | undefined }) {
		if (!args.files?.length) return;

		const imageFiles = Array.from(args.files).filter((file) => file.type.startsWith(`image/`));
		if (!imageFiles.length) return;

		const remainingSlots = Math.max(0, GALLERY_IMAGE_MAX_COUNT - readyOrBusyCount);
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

		await Promise.allSettled(
			pendingPreviews.map((pendingPreview) =>
				processAndUploadSelectedImage({
					previewId: pendingPreview.preview.id,
					file: pendingPreview.file,
				}),
			),
		);
		reportBusy(busy);
		reportFailed(hasFailedUploads);
	}

	async function processAndUploadSelectedImage(args: { previewId: string; file: File }) {
		if (isCancelled(args.previewId)) return;

		updatePreviewState({
			previewId: args.previewId,
			uploadState: `processing`,
			progress: 5,
			error: undefined,
			sourceFile: args.file,
		});

		try {
			const processedFile = await processImageUploadFile({
				file: args.file,
				onProgress: (progress) => {
					if (isCancelled(args.previewId)) return;
					updatePreviewState({
						previewId: args.previewId,
						uploadState: `processing`,
						progress: Math.min(80, progress * 0.8),
						error: undefined,
					});
				},
			});
			if (isCancelled(args.previewId)) return;

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

			const { uploadUrl, publicUrl, claimToken } = await createGalleryImageUploadUrl({
				kind,
				contentType: processedFile.type === `image/jpeg` ? `image/jpeg` : `image/webp`,
			});
			if (isCancelled(args.previewId)) {
				void discardGalleryImage({ claimToken });
				return;
			}

			const response = await fetch(uploadUrl, {
				method: `PUT`,
				body: processedFile,
				headers: { "Content-Type": processedFile.type },
			});
			if (!response.ok) {
				throw new Error(`Upload fehlgeschlagen (HTTP ${response.status})`);
			}
			if (isCancelled(args.previewId)) {
				void discardGalleryImage({ claimToken });
				return;
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
			if (isCancelled(args.previewId)) return;
			updatePreviewState({
				previewId: args.previewId,
				uploadState: `error`,
				progress: 0,
				error: error instanceof Error ? error.message : `Bild konnte nicht hochgeladen werden`,
			});
		}
	}

	function retrySelectedImage(args: { previewId: string }) {
		const preview = previewItems.find((item) => item.id === args.previewId);
		if (!preview?.sourceFile) return;
		cancelledPreviewIds.delete(args.previewId);
		void processAndUploadSelectedImage({
			previewId: args.previewId,
			file: preview.sourceFile,
		});
	}

	function updatePreviewState(args: UpdatePreviewStateArgs) {
		previewItems = previewItems.map((item) => {
			if (item.id !== args.previewId) return item;
			return {
				...item,
				name: args.name ?? item.name,
				sizeLabel: args.sizeLabel ?? item.sizeLabel,
				url: args.url ?? item.url,
				claimToken: args.claimToken ?? item.claimToken,
				sourceFile: args.sourceFile ?? item.sourceFile,
				uploadState: args.uploadState,
				progress: args.progress,
				error: args.error,
			};
		});
		reportBusy(busy);
		reportFailed(hasFailedUploads);
	}

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
		onDirty?.();
	}

	function removeSelectedImage(args: { previewId: string }) {
		const preview = previewItems.find((item) => item.id === args.previewId);
		cancelledPreviewIds.add(args.previewId);
		clearObjectUrlForPreview(args.previewId);
		previewItems = previewItems.filter((x) => x.id !== args.previewId);
		if (preview?.url && fullscreenImageUrl === preview.url) fullscreenImageUrl = null;
		if (preview?.claimToken) void discardGalleryImage({ claimToken: preview.claimToken });
		onDirty?.();
		reportBusy(busy);
		reportFailed(hasFailedUploads);
	}

	function openImagePicker() {
		if (atMaxCount) return;
		imageInputElement?.click();
	}

	function handleDragEnter() {
		if (!isDesktop || atMaxCount) return;
		dragDepth += 1;
	}

	function handleDragLeave() {
		if (!isDesktop || !dragDepth) return;
		dragDepth -= 1;
	}

	async function handleDrop(args: { files: FileList | undefined }) {
		dragDepth = 0;
		if (!isDesktop || atMaxCount) return;
		await addSelectedImages({ files: args.files });
	}

	function formatFileSize(size: number) {
		if (size < 1024) return `${size} B`;
		if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
		return `${(size / (1024 * 1024)).toFixed(1)} MB`;
	}

	type GalleryImagePreviewItem = {
		id: string;
		name: string;
		sizeLabel: string;
		url: string;
		source: `existing` | `new`;
		fingerprint?: string;
		sourceFile?: File;
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
		sourceFile?: File;
		error?: string;
	};

	type UploadState = `ready` | `processing` | `uploading` | `error`;
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key !== `Escape` || !fullscreenImageUrl) return;
		fullscreenImageUrl = null;
	}}
/>

<fieldset class={[`fieldset w-full min-w-0 gap-3`, className]}>
	<legend class="fieldset-legend peer-aria-invalid:text-error">Bilder</legend>

	<div
		role="group"
		aria-label="Bilder auswählen oder ablegen"
		ondragenter={handleDragEnter}
		ondragover={(event) => {
			if (!isDesktop || atMaxCount) return;
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
			data-testid={testId(`input`)}
			class="sr-only"
			type="file"
			accept="image/*"
			multiple
			disabled={atMaxCount}
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
				disabled={atMaxCount}
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
		{hint}
		{#if busy}
			<br />Bilder werden lokal verarbeitet und hochgeladen.
		{/if}
	</p>

	<div
		data-testid={testId(`preview-grid`)}
		class:hidden={previewItems.length === 0}
		class="grid grid-cols-2 gap-3 sm:grid-cols-3"
		role="list"
		aria-label="Ausgewählte Bilder sortieren"
		use:dragHandleZone={{
			items: previewItems,
			flipDurationMs: previewFlipDurationMs,
			delayTouchStart: true,
			dropTargetStyle: { outline: `none` },
		}}
		onconsider={(event) => {
			if (!event.detail.items) return;
			previewItems = event.detail.items;
		}}
		onfinalize={(event) => {
			if (!event.detail.items) return;
			previewItems = event.detail.items;
			onDirty?.();
		}}
	>
		{#each previewItems as preview, i (preview.id)}
			{@const itemName = `Bild #${i + 1}`}
			{@const itemSizeLabel = preview.sizeLabel || `Bereits hochgeladen`}
			<div
				data-testid={testId(`preview-item`)}
				data-upload-state={preview.uploadState}
				animate:flip={{ duration: previewFlipDurationMs }}
				
				class="bg-base-200 group card border-base-300/60 overflow-hidden border"
				role="listitem"
				aria-label={itemName}
			>
				<div class="bg-base-300 relative aspect-square overflow-hidden">
					<div class="badge badge-sm absolute top-2 left-2 z-10">
						{i === 0 ? `Cover Bild` : `Bild #${i + 1}`}
					</div>
					<button
						type="button"
						class="h-full w-full cursor-pointer"
						onclick={() => (fullscreenImageUrl = preview.url)}
						use:dragHandle
						aria-label={`Vollbildansicht von ${itemName} öffnen`}
					>
						<img
							data-testid={testId(`preview-image`)}
							src={preview.url}
							alt={`Vorschau für ${itemName}`}
							class="h-full w-full object-cover"
							draggable="false"
						/>
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
									{#if preview.sourceFile}
										<button
											type="button"
											class="btn btn-xs mt-2"
											data-testid={testId(`preview-retry`)}
											onclick={(e) => {
												e.stopPropagation();
												retrySelectedImage({ previewId: preview.id });
											}}
										>
											Nochmal versuchen
										</button>
									{/if}
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

				<div class="flex items-center justify-between gap-1 px-2 py-1">
					<p class="text-base-content/60 min-w-0 truncate text-xs leading-none">{itemSizeLabel}</p>

					<div class="relative flex items-center">
						<button
							data-testid={testId(`preview-move-left`)}
							type="button"
							class="sr-only top-0 left-0 z-20"
							aria-label={`${itemName} nach links verschieben`}
							disabled={i === 0}
							onmousedown={(e) => e.stopPropagation()}
							onclick={(e) => {
								e.stopPropagation();
								movePreview({ previewId: preview.id, direction: -1 });
							}}
						>
							Nach links
						</button>
						<button
							data-testid={testId(`preview-move-right`)}
							type="button"
							class="sr-only top-0 left-1 z-20"
							aria-label={`${itemName} nach rechts verschieben`}
							disabled={i === previewItems.length - 1}
							onmousedown={(e) => e.stopPropagation()}
							onclick={(e) => {
								e.stopPropagation();
								movePreview({ previewId: preview.id, direction: 1 });
							}}
						>
							Nach rechts
						</button>
						<button
							data-testid={testId(`preview-remove`)}
							type="button"
							class="btn btn-ghost btn-sm btn-circle shrink-0"
							aria-label={`Bild ${itemName} entfernen`}
							onmousedown={(e) => e.stopPropagation()}
							onclick={(e) => {
								e.stopPropagation();
								removeSelectedImage({ previewId: preview.id });
							}}
						>
							<i class="icon-[ph--trash] size-4.5"></i>
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
			<input {...field.as(`checkbox`, token)} checked data-testid={testId(`claim`)} />
		{/each}
	</div>

	{#if field.issues()?.length}
		<div class="mt-2 flex flex-col gap-1">
			{#each field.issues() as issue, i (`${issue.message}-${i}`)}
				<div class="text-error text-xs">{issue.message}</div>
			{/each}
		</div>
	{/if}

	{#if existingImageUrlsField?.issues()?.length}
		<div class="mt-2 flex flex-col gap-1">
			{#each existingImageUrlsField.issues() as issue, i (`${issue.message}-${i}`)}
				<div class="text-error text-xs">{issue.message}</div>
			{/each}
		</div>
	{/if}

	{#if fullscreenImageUrl}
		<button
			type="button"
			class="fixed inset-0 z-70 flex items-center justify-center bg-black/85 p-4"
			in:fade={{ duration: 180 }}
			out:fade={{ duration: 80 }}
			onclick={() => (fullscreenImageUrl = null)}
			aria-label="Vollbildansicht schließen"
		>
			<img src={fullscreenImageUrl} alt="Vollbildansicht" class="max-h-full max-w-full object-contain" />
		</button>
	{/if}
</fieldset>
