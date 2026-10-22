// @ts-nocheck - vite-imagetools query strings beyond `?enhanced` have no ambient types
import type { Picture } from 'vite-imagetools';

import mobile from './offering-hero-mobile.jpeg?enhanced';
import tablet from './offering-hero-tablet.jpeg?enhanced';
import desktop from './offering-hero-desktop.compressed.jpeg?enhanced';

export const offeringHeroMobile = mobile as Picture;
export const offeringHeroTablet = tablet as Picture;
export const offeringHeroDesktop = desktop as Picture;
