// @ts-nocheck - vite-imagetools query strings beyond `?enhanced` have no ambient types
import type { Picture } from 'vite-imagetools';

import mobile from './testcover6.jpeg?enhanced&quality=85';
import tablet from './testcover2.jpeg?enhanced&quality=80';
import desktop from './testcover3.jpeg?enhanced&quality=80';

export const heroMobile = mobile as Picture;
export const heroTablet = tablet as Picture;
export const heroDesktop = desktop as Picture;
