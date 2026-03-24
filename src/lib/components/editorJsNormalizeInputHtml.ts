import type { HTMLPasteEvent } from "@editorjs/editorjs";
import Paragraph from "@editorjs/paragraph";

/**
 * Regex matching `<br>` / `<br/>` for splitting pasted or imported HTML into paragraph blocks.
 */
export const EDITOR_JS_BR_SPLIT = /<br\s*\/?>/i;

/**
 * Escapes plain text for use inside a single HTML paragraph (no tags).
 *
 * @example
 * escapeHtmlForParagraph(`a < b`) // → `a &lt; b`
 */
function escapeHtmlForParagraph(text: string): string {
	return text
		.replaceAll(`&`, `&amp;`)
		.replaceAll(`<`, `&lt;`)
		.replaceAll(`>`, `&gt;`)
		.replaceAll(`"`, `&quot;`);
}

/**
 * Builds `<p>...</p>` chunks from plain lines (Editor.js one block per line, same as plain-text paste).
 *
 * @example
 * linesToParagraphHtml([`Hi`, `There`]) // → `<p>Hi</p><p>There</p>`
 */
function linesToParagraphHtml(lines: string[]): string {
	if (!lines?.length) return `<p></p>`;
	return lines.map((line) => `<p>${escapeHtmlForParagraph(line)}</p>`).join(``);
}

/**
 * Turns plain text with newlines into paragraph HTML for `renderFromHTML`.
 *
 * @example
 * plainTextToEditorJsParagraphHtml(`a\n\nb`) // → `<p>a</p><p>b</p>`
 */
export function plainTextToEditorJsParagraphHtml(text: string): string {
	const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
	return linesToParagraphHtml(lines);
}

function hasUnsafeNestedBlockCloseTags(html: string): boolean {
	return /<\/(p|div|h[1-6]|ul|ol|table)\s*>/i.test(html);
}

/**
 * Splits inline HTML on `<br>` when there is no nested block markup.
 *
 * @example
 * splitInlineHtmlOnBrParts(`<b>a</b><br>c`) // → [`<b>a</b>`, `c`]
 */
export function splitInlineHtmlOnBrParts(innerHtml: string): string[] | null {
	if (!EDITOR_JS_BR_SPLIT.test(innerHtml) || hasUnsafeNestedBlockCloseTags(innerHtml)) {
		return null;
	}
	const parts = innerHtml
		.split(EDITOR_JS_BR_SPLIT)
		.map((s) => s.trim())
		.filter(Boolean);
	if (parts.length < 2) return null;
	return parts;
}

/**
 * If a single P/DIV should become multiple `<p>` chunks for Editor.js, returns combined HTML; otherwise null.
 * Handles `<br>` lines, literal newlines in text-only nodes, and Chrome-style `<div><div>…</div>…</div>`.
 *
 * @example
 * collapseBlockElementToParagraphsHtml(pEl) // `<p>a</p><p>b</p>` when inner was `a<br>b`
 */
export function collapseBlockElementToParagraphsHtml(only: Element): string | null {
	const tag = only.tagName.toLowerCase();
	if (tag !== `p` && tag !== `div`) return null;

	const brParts = splitInlineHtmlOnBrParts(only.innerHTML);
	if (brParts) {
		return brParts.map((p) => `<p>${p}</p>`).join(``);
	}

	if (tag === `div` && only.children.length > 0) {
		const kids = [...only.children];
		if (kids.length >= 2 && kids.every((k) => k.tagName.toLowerCase() === `div`)) {
			return kids
				.map((k) => {
					const nested = collapseBlockElementToParagraphsHtml(k);
					if (nested) return nested;
					return `<p>${k.innerHTML}</p>`;
				})
				.join(``);
		}
	}

	if (only.childElementCount === 0) {
		const text = only.textContent ?? ``;
		if (/\r?\n/.test(text)) {
			const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
			if (lines.length > 1) {
				return linesToParagraphHtml(lines);
			}
		}
	}

	return null;
}

/**
 * Parses normalized multi-`<p>` HTML into paragraph block payloads for `blocks.insert` / `insertMany`.
 *
 * @example
 * paragraphOutputBlocksFromNormalizedHtml(`<p>a</p><p>b</p>`) // two paragraph blocks
 */
export function paragraphOutputBlocksFromNormalizedHtml(normalized: string): { type: string; data: { text: string } }[] {
	const template = document.createElement(`template`);
	template.innerHTML = normalized.trim();
	return [...template.content.querySelectorAll(`p`)].map((p) => ({
		type: `paragraph`,
		data: { text: p.innerHTML },
	}));
}

/**
 * Normalizes description HTML so Editor.js `renderFromHTML` creates one paragraph block per line
 * where the source only had newlines or `<br>` (fixes import / AI prefill and saved round-trips).
 *
 * @example
 * normalizeEditorJsInputHtml(`Hello\nWorld`) // → `<p>Hello</p><p>World</p>`
 * normalizeEditorJsInputHtml(`<p>A<br>B</p>`) // → `<p>A</p><p>B</p>`
 */
export function normalizeEditorJsInputHtml(html: string): string {
	const trimmed = html.trim();
	if (!trimmed) return `<p></p>`;

	const template = document.createElement(`template`);
	template.innerHTML = trimmed;

	const root = template.content;
	const elementChildren = [...root.childNodes].filter((n) => {
		if (n.nodeType !== Node.ELEMENT_NODE) return false;
		const tag = (n as Element).tagName.toUpperCase();
		return ![`META`, `LINK`, `STYLE`].includes(tag);
	}) as Element[];
	const hasNonEmptyTextNode = [...root.childNodes].some(
		(n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? ``).trim().length > 0
	);

	if (!elementChildren.length && hasNonEmptyTextNode) {
		return plainTextToEditorJsParagraphHtml(root.textContent ?? ``);
	}

	if (!elementChildren.length) {
		if (!trimmed.includes(`<`)) {
			return plainTextToEditorJsParagraphHtml(trimmed);
		}
		return trimmed;
	}

	if (elementChildren.length > 1) {
		const allPOrDiv = elementChildren.every(
			(n) => n.nodeType === Node.ELEMENT_NODE && [`p`, `div`].includes(n.tagName.toLowerCase())
		);
		if (allPOrDiv) {
			return elementChildren
				.filter((n) => n.nodeType === Node.ELEMENT_NODE)
				.map((n) => collapseBlockElementToParagraphsHtml(n as Element) ?? (n as Element).outerHTML)
				.join(``);
		}
		return trimmed;
	}

	const only = elementChildren[0];
	const tag = only.tagName.toLowerCase();

	if (tag === `html` || tag === `body`) {
		return normalizeEditorJsInputHtml(only.innerHTML);
	}

	if (tag === `p` || tag === `div`) {
		const collapsed = collapseBlockElementToParagraphsHtml(only);
		if (collapsed) {
			return collapsed;
		}
	}

	return trimmed;
}

/**
 * Paragraph tool that splits pasted `<p>…<br>…</p>` into multiple paragraph blocks.
 *
 * @example
 * Pasting `<p>Line A<br>Line B</p>` yields two blocks instead of one.
 */
export class ParagraphWithSplitPaste extends Paragraph {
	static override get pasteConfig() {
		return {
			tags: [`P`, `DIV`],
		};
	}

	override onPaste(event: HTMLPasteEvent): void {
		const raw = event.detail.data.innerHTML ?? ``;
		const parts = splitInlineHtmlOnBrParts(raw);
		if (parts) {
			this.applySplitPasteParts(parts, event);
			return;
		}

		if (!raw.includes(`<`)) {
			const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
			if (lines.length > 1) {
				this.applySplitPasteParts(lines, event);
				return;
			}
		}

		super.onPaste(event);
	}

	/**
	 * Inserts the first chunk via the default paragraph paste, then adds further chunks as new blocks.
	 *
	 * @example
	 * applySplitPasteParts([`<b>a</b>`, `b`], event)
	 */
	private applySplitPasteParts(parts: string[], event: HTMLPasteEvent): void {
		const firstHost = document.createElement(`p`);
		firstHost.innerHTML = parts[0];
		const synthetic = { ...event, detail: { data: firstHost } } as HTMLPasteEvent;
		super.onPaste(synthetic);

		window.requestAnimationFrame(() => {
			window.requestAnimationFrame(() => {
				let idx = this.api.blocks.getCurrentBlockIndex();
				for (let i = 1; i < parts.length; i++) {
					idx += 1;
					this.api.blocks.insert(`paragraph`, { text: parts[i] }, {}, idx, false);
				}
			});
		});
	}
}
