// export { Dialog } from 'bits-ui';
import { default as OverlayAnimated } from './DialogOverlayAnimated.svelte';
import { default as ContentAnimated } from './DialogContentAnimated.svelte';
import { default as Details } from './DetailsDialog.svelte';
import { Dialog as BitsUiDialog } from 'bits-ui';

export const Dialog = {
    ...BitsUiDialog,
    OverlayAnimated,
    ContentAnimated,
    Details,
}
