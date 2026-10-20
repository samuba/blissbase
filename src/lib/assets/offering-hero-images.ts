// @ts-nocheck - vite-imagetools query strings beyond `?enhanced` have no ambient types
import type { Picture } from 'vite-imagetools';

import mobile from './offering-hero-mobile.jpeg?enhanced';
import tablet from './offering-hero-tablet.jpeg?enhanced';
// Desktop uses a plain compressed JPEG (same pattern as homepage heroDesktopUrl).
// Do not `?enhanced&lossless` this large source — it blows past the PWA 2 MiB precache limit.
import desktopUrl from './offering-hero-desktop.compressed.jpeg';

export const offeringHeroMobile = mobile as Picture;
export const offeringHeroTablet = tablet as Picture;
export const offeringHeroDesktopUrl = desktopUrl;
