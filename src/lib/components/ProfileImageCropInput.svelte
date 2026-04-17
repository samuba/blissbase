<script lang="ts">
	import type { RemoteFormField } from '@sveltejs/kit';
	import Cropper from 'svelte-easy-crop';
	import type { CropArea } from 'svelte-easy-crop';
	import imageCompression from 'browser-image-compression';
	import { toast } from 'svelte-sonner';
	import { Dialog } from '$lib/components/dialog';
	import { createProfileImageUploadUrl } from '$lib/rpc/profile.remote';

	let {
		kind,
		field,
		initialUrl,
		onBusyChange
	}: {
		kind: 'profile' | 'banner';
		field: RemoteFormField<string>;
		initialUrl: string;
		onBusyChange?: (busy: boolean) => void;
	} = $props();

	const targetSize = $derived(
		kind === `profile` ? { width: 265, height: 265 } : { width: 850, height: 300 }
	);
	const aspect = $derived(targetSize.width / targetSize.height);
	const cropShape = $derived(kind === `profile` ? `round` : `rect`);
	const maxSizeMB = 0.35;
	const outputQuality = 0.88;

	// svelte-ignore state_referenced_locally
	let previewUrl = $state(initialUrl);
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

	const currentFieldUrl = $derived(field.value() ?? ``);
	// During upload, prefer the local blob preview over the stored field URL so
	// the user sees the new image immediately instead of the previous one.
	const displayedUrl = $derived(uploading ? previewUrl : currentFieldUrl || previewUrl);

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
	 * Confirms the current crop: compresses, uploads to R2 and stores the public URL on the form field.
	 * @example await confirmCrop();
	 */
	async function confirmCrop() {
		if (!croppedPixels || !originalImage) return;
		busy = true;
		const previousPreviewUrl = previewUrl;
		let localPreviewUrl = ``;
		try {
			const blob = await renderCroppedBlob({
				image: originalImage,
				pixels: croppedPixels
			});

			localPreviewUrl = URL.createObjectURL(blob);
			previewUrl = localPreviewUrl;
			uploading = true;
			dialogOpen = false;

			const { uploadUrl, publicUrl } = await createProfileImageUploadUrl({
				type: kind,
				contentType: blob.type === `image/webp` ? `image/webp` : `image/jpeg`
			});

			const response = await fetch(uploadUrl, {
				method: `PUT`,
				body: blob,
				headers: { 'Content-Type': blob.type }
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
	 * Renders the selected crop area into a WebP (or JPEG fallback) blob at the target size.
	 * @example const blob = await renderCroppedBlob({ image, pixels });
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

		const webpBlob = await canvasToBlob({ canvas, type: `image/webp`, quality: outputQuality });
		if (webpBlob && webpBlob.type === `image/webp` && webpBlob.size <= maxSizeMB * 1024 * 1024) {
			return webpBlob;
		}

		if (webpBlob && webpBlob.type === `image/webp`) {
			return await imageCompression(blobToFile(webpBlob, `crop.webp`), {
				maxSizeMB,
				maxWidthOrHeight: Math.max(targetSize.width, targetSize.height),
				fileType: `image/webp`,
				initialQuality: outputQuality,
				useWebWorker: true
			});
		}

		const jpegBlob = await canvasToBlob({ canvas, type: `image/jpeg`, quality: outputQuality });
		if (!jpegBlob) throw new Error(`JPEG-Kodierung fehlgeschlagen`);
		if (jpegBlob.size <= maxSizeMB * 1024 * 1024) return jpegBlob;

		return await imageCompression(blobToFile(jpegBlob, `crop.jpg`), {
			maxSizeMB,
			maxWidthOrHeight: Math.max(targetSize.width, targetSize.height),
			fileType: `image/jpeg`,
			initialQuality: outputQuality,
			useWebWorker: true
		});
	}

	/**
	 * Wraps canvas.toBlob in a Promise, resolving `null` when the browser cannot encode the requested type.
	 * @example const blob = await canvasToBlob({ canvas, type: `image/webp`, quality: 0.9 });
	 */
	function canvasToBlob(args: { canvas: HTMLCanvasElement; type: string; quality: number }) {
		return new Promise<Blob | null>((resolve) => {
			args.canvas.toBlob((blob) => resolve(blob), args.type, args.quality);
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
	 * Wraps a Blob in a File so browser-image-compression can accept it.
	 * @example const file = blobToFile(blob, `crop.webp`);
	 */
	function blobToFile(blob: Blob, name: string) {
		return new File([blob], name, { type: blob.type, lastModified: Date.now() });
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

<fieldset class="fieldset">
	<legend class="fieldset-legend">{kind === `profile` ? `Profilbild` : `Banner`}</legend>

	{#if displayedUrl}
		{#if kind === `profile`}
			<div class="relative size-22 transition-opacity ring-2 ring-base-500 rounded-full">
				<img
					src={displayedUrl}
					alt=""
					class={[
						`border-base-300 size-22 rounded-full border object-cover cursor-pointer hover:opacity-80`,
						uploading && `opacity-70`
					]}
					title="Bild ändern"
					onclick={openPicker}
				/>
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
				class="bg-base-200 relative w-full overflow-hidden max-h-22 ring-2 ring-base-500 rounded-2xl"
			>
				<img
					src={displayedUrl}
					alt=""
					class={[`size-full object-cover  cursor-pointer hover:opacity-80 transition-opacity `, uploading && `opacity-70`]}
					title="Bild ändern"
					onclick={openPicker}
				/>
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
	{/if}

	<input
		type="hidden"
		{...field.as(`text`)}
		value={field.value() ?? initialUrl}
	/>

	<input
		bind:this={fileInputEl}
		type="file"
		accept="image/*"
		class="sr-only"
		onchange={onFileChange}
		disabled={busy}
	/>

	{#if !displayedUrl}
		<div class="flex flex-wrap items-center gap-2">
			<button
				type="button"
				class="btn"
				onclick={openPicker} 
				disabled={busy}
			>
				<i class="icon-[ph--upload-simple] size-4"></i>
				Bild hochladen
			</button>
		</div>
	{/if}

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
