// @ts-nocheck - vite-imagetools query strings beyond `?enhanced` have no ambient types
import type { Picture } from 'vite-imagetools';

import mobile from './testcover6.jpeg?enhanced&quality=80';
import tablet from './testcover2.jpeg?enhanced&quality=80';
import desktop from './testcover3.jpeg?enhanced&quality=90&format=webp;jpeg';

export const heroMobile = mobile as Picture;
export const heroTablet = tablet as Picture;
export const heroDesktop = desktop as Picture;
