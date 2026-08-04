// @ts-nocheck - vite-imagetools query strings beyond `?enhanced` have no ambient types
import type { Picture } from 'vite-imagetools';

import mobile from './testcover6.jpeg?enhanced';
import tablet from './testcover2.jpeg?enhanced';
import desktop from './testcover3.jpeg?enhanced&lossless=true'; // processing fucks up quality or size for this one
import desktopUrl from './testcover3.compressed.jpeg';


export const heroMobile = mobile as Picture;
export const heroTablet = tablet as Picture;
export const heroDesktop = desktop as Picture;
export const heroDesktopUrl = desktopUrl
