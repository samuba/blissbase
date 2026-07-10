<script lang="ts">
	import { onMount } from "svelte";
	import type { RemoteFormField } from "@sveltejs/kit";
	import { debounce } from "$lib/common";
	import { localeStore } from "$lib/../locales/localeStore.svelte";
	import {
		$createParagraphNode as createParagraphNode,
		$getRoot as getRoot,
		$getSelection as getSelection,
		$insertNodes as insertNodes,
		$isRangeSelection as isRangeSelection,
		CAN_REDO_COMMAND,
		CAN_UNDO_COMMAND,
		COMMAND_PRIORITY_LOW,
		FORMAT_TEXT_COMMAND,
		REDO_COMMAND,
		SELECTION_CHANGE_COMMAND,
		UNDO_COMMAND,
		createEditor,
		type LexicalEditor,
	} from "lexical";
	import { $generateHtmlFromNodes as generateHtmlFromNodes, $generateNodesFromDOM as generateNodesFromDOM } from "@lexical/html";
	import {
		HeadingNode,
		$createHeadingNode as createHeadingNode,
		$isHeadingNode as isHeadingNode,
		registerRichText,
	} from "@lexical/rich-text";
	import {
		INSERT_ORDERED_LIST_COMMAND,
		INSERT_UNORDERED_LIST_COMMAND,
		ListItemNode,
		ListNode,
		REMOVE_LIST_COMMAND,
		$isListNode as isListNode,
		registerList,
	} from "@lexical/list";
	import { LinkNode, TOGGLE_LINK_COMMAND, $isLinkNode as isLinkNode, registerLink } from "@lexical/link";
	import { namedSignals } from "@lexical/extension";
	import { createEmptyHistoryState, registerHistory } from "@lexical/history";
	import { $setBlocksType as setBlocksType } from "@lexical/selection";
	import { $findMatchingParent as findMatchingParent, $getNearestNodeOfType as getNearestNodeOfType, mergeRegister } from "@lexical/utils";

	let {
		field,
		value,
		placeholder,
	}: {
		field: RemoteFormField<string>;
		value?: string;
		placeholder: string;
	} = $props();

	let editor: LexicalEditor | undefined = $state(undefined);
	let editorEl: HTMLElement | undefined = $state(undefined);
	let toolbarEl: HTMLElement | undefined = $state(undefined);
	let toolbarSentinelEl: HTMLElement | undefined = $state(undefined);
	let isToolbarStuck = $state(false);
	let editorValue = $state(``);
	let isEmpty = $state(true);
	let isEditorReady = $state(false);
	let lastRenderedExternalValue = ``;
	let applyingExternalHtml = false;

	let isEditorFocused = $state(false);
	let isBold = $state(false);
	let isItalic = $state(false);
	let isHighlight = $state(false);
	let isLink = $state(false);
	let isHeading = $state(false);
	let isBulletList = $state(false);
	let isNumberedList = $state(false);
	let canUndo = $state(false);
	let canRedo = $state(false);

	const labels = $derived(
		localeStore.locale === `de`
			? {
					bold: `Fett`,
					italic: `Kursiv`,
					highlight: `Hervorheben`,
					link: `Link`,
					heading: `Überschrift`,
					bulletList: `Liste`,
					numberedList: `Nummerierte Liste`,
					linkPrompt: `Link einfügen`,
					undo: `Rückgängig`,
					redo: `Wiederholen`,
				}
			: {
					bold: `Bold`,
					italic: `Italic`,
					highlight: `Highlight`,
					link: `Link`,
					heading: `Heading`,
					bulletList: `Bullet list`,
					numberedList: `Numbered list`,
					linkPrompt: `Add a link`,
					undo: `Undo`,
					redo: `Redo`,
				},
	);

	function normalizeExportedHtml(html: string) {
		const trimmed = html.trim();
		if (!trimmed) return ``;
		if (trimmed === `<p><br></p>` || trimmed === `<p></p>`) return ``;
		return trimmed;
	}

	function syncEmptyFromEditor(nextEditor: LexicalEditor) {
		nextEditor.getEditorState().read(() => {
			isEmpty = !normalizeExportedHtml(generateHtmlFromNodes(nextEditor, null));
		});
	}

	function setHtmlFromEditor(nextEditor: LexicalEditor) {
		nextEditor.getEditorState().read(() => {
			const html = normalizeExportedHtml(generateHtmlFromNodes(nextEditor, null));
			editorValue = html;
			lastRenderedExternalValue = html;
			isEmpty = !html;
		});
	}

	function renderHtml(args: { nextEditor: LexicalEditor; html: string }) {
		const { nextEditor, html } = args;
		applyingExternalHtml = true;
		nextEditor.update(
			() => {
				const root = getRoot();
				root.clear();
				const trimmed = html.trim();
				if (!trimmed) {
					root.append(createParagraphNode());
					return;
				}
				const parser = new DOMParser();
				const dom = parser.parseFromString(trimmed, `text/html`);
				const nodes = generateNodesFromDOM(nextEditor, dom);
				if (!nodes?.length) {
					root.append(createParagraphNode());
					return;
				}
				root.select();
				insertNodes(nodes);
			},
			{
				onUpdate: () => {
					applyingExternalHtml = false;
					lastRenderedExternalValue = html;
					syncEmptyFromEditor(nextEditor);
				},
			},
		);
	}

	function updateToolbar(nextEditor: LexicalEditor) {
		nextEditor.getEditorState().read(() => {
			const selection = getSelection();
			if (!isRangeSelection(selection)) {
				isBold = false;
				isItalic = false;
				isHighlight = false;
				isLink = false;
				isHeading = false;
				isBulletList = false;
				isNumberedList = false;
				return;
			}

			isBold = selection.hasFormat(`bold`);
			isItalic = selection.hasFormat(`italic`);
			isHighlight = selection.hasFormat(`highlight`);

			const anchorNode = selection.anchor.getNode();
			const linkParent = findMatchingParent(anchorNode, isLinkNode);
			isLink = linkParent !== null;

			const element =
				anchorNode.getKey() === `root`
					? anchorNode
					: findMatchingParent(anchorNode, (node) => {
							const parent = node.getParent();
							return parent !== null && getRoot().is(parent);
						});

			if (isHeadingNode(element) && element.getTag() === `h3`) {
				isHeading = true;
			} else {
				isHeading = false;
			}

			const listNode = getNearestNodeOfType(anchorNode, ListNode);
			if (isListNode(listNode)) {
				const listType = listNode.getListType();
				isBulletList = listType === `bullet`;
				isNumberedList = listType === `number`;
			} else {
				isBulletList = false;
				isNumberedList = false;
			}
		});
	}

	function formatText(format: `bold` | `italic` | `highlight`) {
		editor?.dispatchCommand(FORMAT_TEXT_COMMAND, format);
	}

	function undo() {
		editor?.dispatchCommand(UNDO_COMMAND, undefined);
	}

	function redo() {
		editor?.dispatchCommand(REDO_COMMAND, undefined);
	}

	function toggleHeading() {
		const nextEditor = editor;
		if (!nextEditor) return;
		nextEditor.update(() => {
			const selection = getSelection();
			if (!isRangeSelection(selection)) return;
			if (isHeading) {
				setBlocksType(selection, () => createParagraphNode());
				return;
			}
			setBlocksType(selection, () => createHeadingNode(`h3`));
		});
	}

	function toggleBulletList() {
		const nextEditor = editor;
		if (!nextEditor) return;
		if (isBulletList) {
			nextEditor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
			return;
		}
		nextEditor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
	}

	function toggleNumberedList() {
		const nextEditor = editor;
		if (!nextEditor) return;
		if (isNumberedList) {
			nextEditor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
			return;
		}
		nextEditor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
	}

	function updateToolbarPosition() {
		if (!toolbarEl || !toolbarSentinelEl) return;
		// Mobile keyboards pan the visual viewport, while CSS sticky remains tied to the layout viewport.
		toolbarEl.style.removeProperty(`--visual-viewport-offset`);
		const stickyTop = parseFloat(getComputedStyle(toolbarEl).top) || 0;
		const visualViewportTop = window.visualViewport?.offsetTop ?? 0;
		const targetTop = visualViewportTop + stickyTop;
		const toolbarTop = toolbarEl.getBoundingClientRect().top;
		const visualViewportOffset = Math.max(0, targetTop - toolbarTop);
		if (visualViewportOffset > 0.5) {
			toolbarEl.style.setProperty(`--visual-viewport-offset`, `${visualViewportOffset}px`);
		}
		isToolbarStuck = toolbarSentinelEl.getBoundingClientRect().bottom <= targetTop + 0.5;
	}

	function toggleLink() {
		const nextEditor = editor;
		if (!nextEditor) return;
		if (isLink) {
			nextEditor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
			return;
		}
		const url = window.prompt(labels.linkPrompt, `https://`);
		if (!url?.trim()) return;
		nextEditor.dispatchCommand(TOGGLE_LINK_COMMAND, url.trim());
	}

	$effect(() => {
		const nextValue = field.value() || value || ``;
		if (!isEditorReady) return;
		if (!editor) return;
		if (nextValue === lastRenderedExternalValue) return;
		editorValue = nextValue;
		renderHtml({ nextEditor: editor, html: nextValue });
	});

	onMount(() => {
		const visualViewport = window.visualViewport;
		let toolbarUpdateFrame: number | undefined;
		// Viewport scroll and resize events are frequent, so coalesce toolbar updates into one animation frame.
		const applyToolbarPosition = () => {
			toolbarUpdateFrame = undefined;
			updateToolbarPosition();
		};
		const onScrollOrResize = () => {
			if (toolbarUpdateFrame !== undefined) return;
			toolbarUpdateFrame = window.requestAnimationFrame(applyToolbarPosition);
		};
		const cleanupToolbarPosition = () => {
			window.removeEventListener(`scroll`, onScrollOrResize, true);
			window.removeEventListener(`resize`, onScrollOrResize);
			visualViewport?.removeEventListener(`scroll`, onScrollOrResize);
			visualViewport?.removeEventListener(`resize`, onScrollOrResize);
			if (toolbarUpdateFrame !== undefined) {
				window.cancelAnimationFrame(toolbarUpdateFrame);
			}
			// Remove the inline visual-viewport compensation along with listeners and pending work.
			toolbarEl?.style.removeProperty(`--visual-viewport-offset`);
		};
		window.addEventListener(`scroll`, onScrollOrResize, { passive: true, capture: true });
		window.addEventListener(`resize`, onScrollOrResize);
		visualViewport?.addEventListener(`scroll`, onScrollOrResize, { passive: true });
		visualViewport?.addEventListener(`resize`, onScrollOrResize);
		updateToolbarPosition();

		if (!editorEl) {
			return cleanupToolbarPosition;
		}

		const nextEditor = createEditor({
			namespace: `BlissbaseEditor`,
			nodes: [HeadingNode, ListNode, ListItemNode, LinkNode],
			onError: (error) => {
				console.error(error);
			},
			theme: {
				link: `link`,
				text: {
					bold: `font-bold`,
					italic: `italic`,
					highlight: `bg-warning/40`,
				},
			},
		});

		nextEditor.setRootElement(editorEl);

		const syncHtml = debounce(() => {
			if (applyingExternalHtml) return;
			setHtmlFromEditor(nextEditor);
		}, 300);

		const unregister = mergeRegister(
			registerRichText(nextEditor),
			registerHistory(nextEditor, createEmptyHistoryState(), 300),
			registerList(nextEditor),
			registerLink(
				nextEditor,
				namedSignals({
					validateUrl: undefined,
					attributes: { rel: `noopener noreferrer`, target: `_blank` },
				}),
			),
			nextEditor.registerUpdateListener(() => {
				updateToolbar(nextEditor);
				syncEmptyFromEditor(nextEditor);
				syncHtml();
			}),
			nextEditor.registerCommand(
				SELECTION_CHANGE_COMMAND,
				() => {
					updateToolbar(nextEditor);
					return false;
				},
				COMMAND_PRIORITY_LOW,
			),
			nextEditor.registerCommand(
				CAN_UNDO_COMMAND,
				(payload) => {
					canUndo = payload;
					return false;
				},
				COMMAND_PRIORITY_LOW,
			),
			nextEditor.registerCommand(
				CAN_REDO_COMMAND,
				(payload) => {
					canRedo = payload;
					return false;
				},
				COMMAND_PRIORITY_LOW,
			),
		);

		editor = nextEditor;
		const initialHtml = field.value() || value || ``;
		editorValue = initialHtml;
		renderHtml({ nextEditor, html: initialHtml });
		isEditorReady = true;

		return () => {
			cleanupToolbarPosition();
			unregister();
			nextEditor.setRootElement(null);
			editor = undefined;
			isEditorReady = false;
		};
	});
</script>

<div class="lexical-editor-root w-full">
	<div bind:this={toolbarSentinelEl} class="pointer-events-none h-px w-full" aria-hidden="true"></div>
	<div
		bind:this={toolbarEl}
		class={[
			`lexical-toolbar bg-base-200 sticky top-0 z-40 mb-0 flex flex-wrap justify-center overflow-clip border-2 sm:flex-nowrap sm:justify-start md:top-19`,
			isToolbarStuck ? `rounded-t-none` : `rounded-t-2xl`,
			isEditorFocused ? `border-neutral border-b-base-500` : `border-base-500`,
		]}
		role="toolbar"
		aria-label="Textformatierung"
		tabindex="-1"
		onmousedown={(e) => {
			e.preventDefault();
		}}
	>
		<div class="flex w-full flex-wrap justify-center sm:justify-start [&>button]:rounded-none [&>button]:border-0">
			<button
				type="button"
				class={["btn btn-square btn-sm sm:btn-md", isBold && `btn-active`]}
				aria-label={labels.bold}
				title={labels.bold}
				aria-pressed={isBold}
				onclick={() => formatText(`bold`)}
			>
				<i class="icon-[ph--text-b] size-4 sm:size-5"></i>
			</button>
			<button
				type="button"
				class={["btn btn-square btn-sm sm:btn-md", isItalic && `btn-active`]}
				aria-label={labels.italic}
				title={labels.italic}
				aria-pressed={isItalic}
				onclick={() => formatText(`italic`)}
			>
				<i class="icon-[ph--text-italic] size-4 sm:size-5"></i>
			</button>
			<button
				type="button"
				class={["btn btn-square btn-sm sm:btn-md", isLink && `btn-active`]}
				aria-label={labels.link}
				title={labels.link}
				aria-pressed={isLink}
				onclick={toggleLink}
			>
				<i class="icon-[ph--link] size-4 sm:size-5"></i>
			</button>
			<button
				type="button"
				class={["btn btn-square btn-sm sm:btn-md", isHeading && `btn-active`]}
				aria-label={labels.heading}
				title={labels.heading}
				aria-pressed={isHeading}
				onclick={toggleHeading}
			>
				<i class="icon-[ph--text-h] size-4 sm:size-5"></i>
			</button>
			<button
				type="button"
				class={["btn btn-square btn-sm sm:btn-md", isBulletList && `btn-active`]}
				aria-label={labels.bulletList}
				title={labels.bulletList}
				aria-pressed={isBulletList}
				onclick={toggleBulletList}
			>
				<i class="icon-[ph--list-bullets] size-4 sm:size-5"></i>
			</button>
			<button
				type="button"
				class={["btn btn-square btn-sm sm:btn-md", isNumberedList && `btn-active`]}
				aria-label={labels.numberedList}
				title={labels.numberedList}
				aria-pressed={isNumberedList}
				onclick={toggleNumberedList}
			>
				<i class="icon-[ph--list-numbers] size-4 sm:size-5"></i>
			</button>
			<button
				type="button"
				class={["btn btn-square btn-sm sm:btn-md", isHighlight && `btn-active`]}
				aria-label={labels.highlight}
				title={labels.highlight}
				aria-pressed={isHighlight}
				onclick={() => formatText(`highlight`)}
			>
				<i class="icon-[ph--highlighter] size-4 sm:size-5"></i>
			</button>
			<div class="hidden sm:block sm:flex-1" aria-hidden="true"></div>
			<button
				type="button"
				class="btn btn-square btn-sm sm:btn-md"
				title={labels.undo}
				aria-label={labels.undo}
				aria-disabled={!canUndo}
				onclick={undo}
				disabled={!canUndo}
			>
				<i class="icon-[ph--arrow-u-up-left] size-4 sm:size-5"></i>
			</button>
			<button
				type="button"
				class="btn btn-square btn-sm sm:btn-md"
				title={labels.redo}
				aria-label={labels.redo}
				aria-disabled={!canRedo}
				onclick={redo}
				disabled={!canRedo}
			>
				<i class="icon-[ph--arrow-u-up-right] size-4 sm:size-5"></i>
			</button>
		</div>
	</div>

	<div class="relative">
		{#if isEmpty}
			<div class="text-base-content/40 pointer-events-none absolute inset-0 z-10 px-4 py-4 text-base" aria-hidden="true">
				{placeholder}
			</div>
		{/if}
		<div
			bind:this={editorEl}
			class="prose textarea lexical-editor min-h-32 w-full max-w-none rounded-t-none! border-t-0"
			contenteditable="true"
			aria-placeholder={placeholder}
			onfocus={() => {
				isEditorFocused = true;
			}}
			onblur={() => {
				isEditorFocused = false;
			}}
		></div>
	</div>

	<textarea {...field.as("text")} class="peer hidden" aria-hidden="true" value={editorValue}></textarea>
</div>

<style>
	@reference '../../app.css';

	.lexical-editor:focus {
		outline: none;
	}

	.lexical-toolbar {
		transform: translateY(var(--visual-viewport-offset, 0px));
	}

	/* Highlight isn't covered by typography — keep marker readable in the editor. */
	.lexical-editor :global(mark) {
		background-color: color-mix(in oklab, var(--color-warning) 40%, transparent);
		border-radius: 0.15em;
		padding: 0 0.1em;
	}
</style>
