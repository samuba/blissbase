declare module 'browser-image-compression' {
	export interface Options {
		maxSizeMB?: number;
		maxWidthOrHeight?: number;
		useWebWorker?: boolean;
		maxIteration?: number;
		exifOrientation?: number;
		onProgress?: (progress: number) => void;
		fileType?: string;
		initialQuality?: number;
		alwaysKeepResolution?: boolean;
		signal?: AbortSignal;
		preserveExif?: boolean;
		libURL?: string;
	}

	export default function imageCompression(image: File, options: Options): Promise<File>;
}
