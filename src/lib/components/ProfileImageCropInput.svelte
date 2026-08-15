<script lang="ts">
	import type { RemoteFormField } from '@sveltejs/kit';
	import Cropper from 'svelte-easy-crop';
	import type { CropArea } from 'svelte-easy-crop';
	import { processImageDataToWebPFile } from '$lib/imageUpload';
	import { toast } from 'svelte-sonner';
	import { Dialog } from '$lib/components/dialog';
	import { createProfileImageUploadUrl } from '$lib/rpc/profile.remote';

	let {
		kind,
		field,
		initialUrl = ``,
		onBusyChange,
		class: className
	}: {
		kind: 'profile' | 'banner';
		field: RemoteFormField<string>;
		initialUrl?: string;
		onBusyChange?: (busy: boolean) => void;
		class?: string;
	} = $props();

	const targetSize = $derived(
		kind === `profile` ? { width: 265, height: 265 } : { width: 850, height: 300 }
	);
	const aspect = $derived(targetSize.width / targetSize.height);
	const cropShape = $derived(kind === `profile` ? `round` : `rect`);

	let previewUrl = $state(``);
	let fileInputEl = $state<HTMLInputElement | undefined>();
	let originalDataUrl = $state(``);
	let originalImage = $state<HTMLImageElement | undefined>();
	let dialogOpen = $state(false);
	let crop = $state({ x: 0, y: 0 });
	let zoom = $state(1);
	let croppedPixels = $state<CropArea | undefined>();
	let busy = $state(false);
	let uploading = $state(false);
	let windowInnerHeight = $state(0);

	const storedUrl = $derived((field.value() ?? initialUrl ?? ``).trim());
	// During upload, prefer the local blob preview over the stored field URL so
	// the user sees the new image immediately instead of the previous one.
	const displayedUrl = $derived(uploading ? previewUrl : storedUrl);

	$effect(() => {
		onBusyChange?.(busy);
	});

	/**
	 * Opens the file picker.
	 * @example openPicker();
	 */
	function openPicker() {
		if (busy) return;
		fileInputEl?.click();
	}

	/**
	 * Handles a newly chosen file by loading it into the cropper modal.
	 * @example await onFileChange(ev);
	 */
	async function onFileChange(event: Event) {
		const target = event.currentTarget as HTMLInputElement;
		const file = target.files?.[0];
		target.value = ``;
		if (!file) return;
		if (!file.type.startsWith(`image/`)) {
			toast.error(`Bitte wähle eine Bilddatei.`);
			return;
		}

		try {
			busy = true;
			const dataUrl = await readFileAsDataUrl(file);
			const image = await loadImageFromUrl(dataUrl);
			originalDataUrl = dataUrl;
			originalImage = image;
			crop = { x: 0, y: 0 };
			zoom = 1;
			croppedPixels = undefined;
			dialogOpen = true;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : `Bild konnte nicht geladen werden.`);
		} finally {
			busy = false;
		}
	}

	/**
	 * Confirms the current crop: encodes to WebP, uploads to R2 and stores the public URL on the form field.
	 * @example await confirmCrop();
	 */
	async function confirmCrop() {
		if (!croppedPixels || !originalImage) return;
		busy = true;
		const previousPreviewUrl = previewUrl;
		let localPreviewUrl = ``;
		try {
			const file = await renderCroppedBlob({
				image: originalImage,
				pixels: croppedPixels
			});

			localPreviewUrl = URL.createObjectURL(file);
			previewUrl = localPreviewUrl;
			uploading = true;
			dialogOpen = false;

			const { uploadUrl, publicUrl } = await createProfileImageUploadUrl({
				type: kind,
				contentType: file.type === `image/webp` ? `image/webp` : `image/jpeg`
			});

			const response = await fetch(uploadUrl, {
				method: `PUT`,
				body: file,
				headers: { 'Content-Type': file.type }
			});
			if (!response.ok) {
				throw new Error(`Upload fehlgeschlagen (HTTP ${response.status})`);
			}

			field.set(publicUrl);
			previewUrl = publicUrl;
		} catch (err) {
			previewUrl = previousPreviewUrl;
			toast.error(err instanceof Error ? err.message : `Upload fehlgeschlagen.`);
		} finally {
			if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
			uploading = false;
			busy = false;
		}
	}

	/**
	 * Renders the selected crop area into a WebP upload file at the target size.
	 * @example const file = await renderCroppedBlob({ image, pixels });
	 */
	async function renderCroppedBlob(args: { image: HTMLImageElement; pixels: CropArea }) {
		const canvas = document.createElement(`canvas`);
		canvas.width = targetSize.width;
		canvas.height = targetSize.height;
		const ctx = canvas.getContext(`2d`);
		if (!ctx) throw new Error(`Canvas Kontext konnte nicht erstellt werden`);
		ctx.imageSmoothingQuality = `high`;
		ctx.drawImage(
			args.image,
			args.pixels.x,
			args.pixels.y,
			args.pixels.width,
			args.pixels.height,
			0,
			0,
			targetSize.width,
			targetSize.height
		);

		const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
		return await processImageDataToWebPFile({
			imageData,
			originalFileName: `${kind}.webp`
		});
	}

	/**
	 * Reads a File into a data URL string.
	 * @example const dataUrl = await readFileAsDataUrl(file);
	 */
	function readFileAsDataUrl(file: File) {
		return new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onerror = () => reject(new Error(`Bilddatei konnte nicht gelesen werden`));
			reader.onload = () => resolve(reader.result as string);
			reader.readAsDataURL(file);
		});
	}

	/**
	 * Loads an HTMLImageElement from a URL or data URL.
	 * @example const image = await loadImageFromUrl(dataUrl);
	 */
	function loadImageFromUrl(url: string) {
		return new Promise<HTMLImageElement>((resolve, reject) => {
			const image = new Image();
			image.onload = () => resolve(image);
			image.onerror = () => reject(new Error(`Bild konnte nicht geladen werden`));
			image.src = url;
		});
	}

	/**
	 * Clears the currently selected image.
	 * @example removeImage();
	 */
	function removeImage() {
		if (busy) return;
		field.set(``);
		previewUrl = ``;
	}

	function onDialogOpenChange(next: boolean) {
		if (busy && !next) return;
		dialogOpen = next;
	}
</script>

<svelte:window bind:innerHeight={windowInnerHeight} />

<fieldset class={[`fieldset`, className]} data-testid={`${kind}-image-crop`}>
	<legend class="fieldset-legend">{kind === `profile` ? `Profilbild` : `Banner`}</legend>

	{#if kind === `profile`}
		<div class="relative size-22 transition-opacity ring-2 ring-base-500 rounded-full">
			{#if displayedUrl}
				<button
					type="button"
					class={[`cursor-pointer hover:opacity-80`, uploading && `opacity-70`]}
					title="Bild ändern"
					onclick={openPicker}
					disabled={busy}
				>
					<img
						src={displayedUrl}
						alt=""
						class="border-base-300 size-22 rounded-full border object-cover"
					/>
				</button>
			{:else}
				<button
					type="button"
					class="bg-base-200 text-primary border-base-300 flex size-22 cursor-pointer items-center justify-center rounded-full border hover:opacity-80"
					title="Bild hochladen"
					onclick={openPicker}
					disabled={busy}
				>
					<i class="icon-[ph--user-circle] size-14"></i>
				</button>
			{/if}
			{#if displayedUrl}
				<button
					type="button"
					class="btn btn-circle btn-warning btn-xs absolute bottom-0 right-0"
					title="Bild entfernen"
					onclick={removeImage}
					disabled={busy}
				>
					<i class="icon-[ph--trash] size-4"></i>
				</button>
			{/if}
			{#if uploading}
				<div
					class="absolute inset-0 flex items-center justify-center rounded-full bg-black/50"
				>
					<span class="loading loading-spinner loading-xl text-primary"></span>
				</div>
			{/if}
		</div>
	{:else}
		<div
			class="bg-base-200 relative h-22 w-full overflow-hidden ring-2 ring-base-500 rounded-2xl"
		>
			{#if displayedUrl}
				<button
					type="button"
					class={[`size-full cursor-pointer hover:opacity-80 transition-opacity`, uploading && `opacity-70`]}
					title="Bild ändern"
					onclick={openPicker}
					disabled={busy}
				>
					<img
						src={displayedUrl}
						alt=""
						class="size-full object-cover"
					/>
				</button>
			{:else}
				<button
					type="button"
					class="text-primary-content flex gap-4 size-full cursor-pointer items-center justify-center hover:opacity-80"
					title="Bild hochladen"
					onclick={openPicker}
					disabled={busy}
				>
					<i class="icon-[ph--image] size-12 text-primary"></i>
					<div class="text-sm ">
						Bild auswählen
						<p class="hidden sm:block">oder ablegen</p>
					</div>
				</button>
			{/if}
			{#if displayedUrl}
				<button
					type="button"
					class="btn btn-circle btn-warning btn-xs absolute bottom-1.5 right-1.5"
					title="Bild entfernen"
					onclick={removeImage}
					disabled={busy}
				>
					<i class="icon-[ph--trash] size-4"></i>
				</button>
			{/if}
			{#if uploading}
				<div class="absolute inset-0 flex items-center justify-center bg-black/50">
					<span class="loading loading-spinner loading-xl text-primary"></span>
				</div>
			{/if}
		</div>
	{/if}

	<input
		type="hidden"
		{...field.as(`text`, initialUrl)}
	/>

	<input
		bind:this={fileInputEl}
		type="file"
		accept="image/*"
		class="sr-only"
		data-testid={`${kind}-image-file`}
		onchange={onFileChange}
		disabled={busy}
	/>

	{#if field.issues()?.length}
		<div class="mt-2 flex flex-col gap-1">
			{#each field.issues() as issue, i (`${issue.message}-${i}`)}
				<div class="text-red-600 text-xs">{issue.message}</div>
			{/each}
		</div>
	{/if}
</fieldset>

<Dialog.Root open={dialogOpen} onOpenChange={onDialogOpenChange}>
	<Dialog.Portal>
		<Dialog.OverlayAnimated class="bg-base-200/80 fixed inset-0 z-60 backdrop-blur-sm" />
		<Dialog.ContentAnimated
			class="bg-base-100 fixed top-1/2 left-1/2 z-70 flex max-h-[90vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-hidden rounded-xl p-4 shadow-xl sm:p-6"
		>
			<Dialog.Title class="text-lg font-semibold">
				{kind === `profile` ? `Profilbild zuschneiden` : `Banner zuschneiden`}
			</Dialog.Title>
			<Dialog.Description class="text-base-content/70 -mt-2 text-sm">
				Verschiebe und zoome das Bild, um den sichtbaren Ausschnitt festzulegen.
			</Dialog.Description>

			{#if originalDataUrl}
				<div
					class="bg-base-300 relative w-full overflow-hidden rounded-lg"
					style:height={`${Math.min(Math.max(windowInnerHeight - 320, 260), 480)}px`}
				>
					<Cropper
						image={originalDataUrl}
						bind:crop
						bind:zoom
						{aspect}
						{cropShape}
						showGrid={false}
						oncropcomplete={(e) => (croppedPixels = e.pixels)}
					/>
				</div>

				<div class="flex items-center gap-3">
					<i class="icon-[ph--magnifying-glass-minus] size-5 shrink-0"></i>
					<input
						type="range"
						min={1}
						max={4}
						step={0.01}
						bind:value={zoom}
						class="range range-primary-content range-sm flex-1"
						aria-label="Zoom"
						disabled={busy}
					/>
					<i class="icon-[ph--magnifying-glass-plus] size-5 shrink-0"></i>
				</div>
			{/if}

			<div class="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
				<Dialog.Close class="btn btn-ghost" type="button" disabled={busy}>
					Abbrechen
				</Dialog.Close>
				<button
					type="button"
					class="btn btn-primary"
					data-testid={`${kind}-crop-done`}
					onclick={confirmCrop}
					disabled={busy || !croppedPixels}
				>
					{#if busy}
						<span class="loading loading-spinner loading-sm"></span>
						Wird hochgeladen…
					{:else}
						<i class="icon-[ph--check] size-4"></i>
						Fertig
					{/if}
				</button>
			</div>
		</Dialog.ContentAnimated>
	</Dialog.Portal>
</Dialog.Root>
