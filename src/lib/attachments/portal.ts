import type { Attachment } from "svelte/attachments";

/** Move an element to `document.body` so it escapes ancestor stacking contexts. */
export const portalToBody: Attachment = (node) => {
	document.body.appendChild(node);
	return () => {
		node.remove();
	};
};
