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
	let isToolbarStuck = $state(false);
	let editorValue = $state(``);
	let isEmpty = $state(true);
	let isEditorReady = $state(false);
	let lastRenderedExternalValue = ``;
	let applyingExternalHtml = false;
	let cachedToolbarStickyTop: number | undefined;
	let appliedToolbarOffset = 0;

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
		const nextToolbarEl = toolbarEl;
		if (!nextToolbarEl) return;

		// Mobile keyboards pan the visual viewport, while CSS sticky remains tied to the layout viewport.
		// Cache the CSS sticky inset between layout resizes, then read all geometry before writing the transform.
		const stickyTop = cachedToolbarStickyTop ?? (cachedToolbarStickyTop = parseFloat(getComputedStyle(nextToolbarEl).top) || 0);
		const visualViewportTop = window.visualViewport?.offsetTop ?? 0;
		const targetTop = visualViewportTop + stickyTop;
		const toolbarRect = nextToolbarEl.getBoundingClientRect();
		const baseToolbarTop = toolbarRect.top - appliedToolbarOffset;
		const baseToolbarBottom = toolbarRect.bottom - appliedToolbarOffset;
		const containerBottom = nextToolbarEl.parentElement?.getBoundingClientRect().bottom ?? baseToolbarBottom;

		// End compensation 30px before the containing block, including shifting CSS sticky upward at its lower boundary.
		const maxToolbarOffset = containerBottom - baseToolbarBottom - 30;
		const calculatedToolbarOffset = Math.min(Math.max(0, targetTop - baseToolbarTop), maxToolbarOffset);
		const nextToolbarOffset = Math.abs(calculatedToolbarOffset) > 0.5 ? calculatedToolbarOffset : 0;
		const toolbarOffsetChanged =
			nextToolbarOffset === 0 ? appliedToolbarOffset !== 0 : Math.abs(nextToolbarOffset - appliedToolbarOffset) > 0.5;

		if (toolbarOffsetChanged) {
			appliedToolbarOffset = nextToolbarOffset;
			if (nextToolbarOffset === 0) {
				nextToolbarEl.style.removeProperty(`transform`);
			} else {
				nextToolbarEl.style.transform = `translate3d(0, ${nextToolbarOffset}px, 0)`;
			}
		}

		const nextIsToolbarStuck = baseToolbarTop <= targetTop + 0.5;
		if (nextIsToolbarStuck !== isToolbarStuck) {
			isToolbarStuck = nextIsToolbarStuck;
		}
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
		// Layout scrolling and VisualViewport keyboard events can overlap, so coalesce them into one frame.
		const applyToolbarPosition = () => {
			toolbarUpdateFrame = undefined;
			updateToolbarPosition();
		};
		const scheduleToolbarUpdate = () => {
			if (toolbarUpdateFrame !== undefined) return;
			toolbarUpdateFrame = window.requestAnimationFrame(applyToolbarPosition);
		};
		const onWindowResize = () => {
			// CSS breakpoints can change the sticky top; keyboard-only visual viewport resizes cannot.
			cachedToolbarStickyTop = undefined;
			scheduleToolbarUpdate();
		};
		const cleanupToolbarPosition = () => {
			window.removeEventListener(`scroll`, scheduleToolbarUpdate, true);
			window.removeEventListener(`resize`, onWindowResize);
			visualViewport?.removeEventListener(`scroll`, scheduleToolbarUpdate);
			visualViewport?.removeEventListener(`resize`, scheduleToolbarUpdate);
			if (toolbarUpdateFrame !== undefined) {
				window.cancelAnimationFrame(toolbarUpdateFrame);
			}
			// Remove inline compensation and reset non-reactive caches along with pending work.
			toolbarEl?.style.removeProperty(`transform`);
			cachedToolbarStickyTop = undefined;
			appliedToolbarOffset = 0;
		};
		window.addEventListener(`scroll`, scheduleToolbarUpdate, { passive: true, capture: true });
		window.addEventListener(`resize`, onWindowResize);
		visualViewport?.addEventListener(`scroll`, scheduleToolbarUpdate, { passive: true });
		visualViewport?.addEventListener(`resize`, scheduleToolbarUpdate);
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
	<div
		bind:this={toolbarEl}
		class={[
			`lexical-toolbar bg-base-100 sticky top-0 z-40 mb-0 flex flex-wrap justify-center overflow-clip border-2 sm:flex-nowrap sm:justify-start md:top-19`,
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
		<div class="flex w-full flex-wrap justify-center sm:justify-start">
			<button
				type="button"
				class={["toolbar-button", isBold && `toolbar-button-active`]}
				aria-label={labels.bold}
				title={labels.bold}
				aria-pressed={isBold}
				onclick={() => formatText(`bold`)}
			>
				<i class="icon-[ph--text-b] size-5"></i>
			</button>
			<button
				type="button"
				class={["toolbar-button", isItalic && `toolbar-button-active`]}
				aria-label={labels.italic}
				title={labels.italic}
				aria-pressed={isItalic}
				onclick={() => formatText(`italic`)}
			>
				<i class="icon-[ph--text-italic] size-5"></i>
			</button>
			<button
				type="button"
				class={["toolbar-button", isLink && `toolbar-button-active`]}
				aria-label={labels.link}
				title={labels.link}
				aria-pressed={isLink}
				onclick={toggleLink}
			>
				<i class="icon-[ph--link] size-5"></i>
			</button>
			<button
				type="button"
				class={["toolbar-button", isHeading && `toolbar-button-active`]}
				aria-label={labels.heading}
				title={labels.heading}
				aria-pressed={isHeading}
				onclick={toggleHeading}
			>
				<i class="icon-[ph--text-h] size-5"></i>
			</button>
			<button
				type="button"
				class={["toolbar-button", isBulletList && `toolbar-button-active`]}
				aria-label={labels.bulletList}
				title={labels.bulletList}
				aria-pressed={isBulletList}
				onclick={toggleBulletList}
			>
				<i class="icon-[ph--list-bullets] size-5"></i>
			</button>
			<button
				type="button"
				class={["toolbar-button", isNumberedList && `toolbar-button-active`]}
				aria-label={labels.numberedList}
				title={labels.numberedList}
				aria-pressed={isNumberedList}
				onclick={toggleNumberedList}
			>
				<i class="icon-[ph--list-numbers] size-5"></i>
			</button>
			<button
				type="button"
				class={["toolbar-button", isHighlight && `toolbar-button-active`]}
				aria-label={labels.highlight}
				title={labels.highlight}
				aria-pressed={isHighlight}
				onclick={() => formatText(`highlight`)}
			>
				<i class="icon-[ph--highlighter] size-5"></i>
			</button>
			<div class="hidden sm:block sm:flex-1" aria-hidden="true"></div>
			<button
				type="button"
				class="toolbar-button"
				title={labels.undo}
				aria-label={labels.undo}
				aria-disabled={!canUndo}
				onclick={undo}
				disabled={!canUndo}
			>
				<i class="icon-[ph--arrow-u-up-left] size-5"></i>
			</button>
			<button
				type="button"
				class="toolbar-button"
				title={labels.redo}
				aria-label={labels.redo}
				aria-disabled={!canRedo}
				onclick={redo}
				disabled={!canRedo}
			>
				<i class="icon-[ph--arrow-u-up-right] size-5"></i>
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
			class="prose textarea lexical-editor py-1 min-h-32 w-full max-w-none rounded-t-none! border-t-0"
			contenteditable="true"
			aria-placeholder={placeholder}
			onfocus={() => isEditorFocused = true}
			onblur={() => isEditorFocused = false}
		></div>
	</div>

	<textarea {...field.as("text")} class="peer hidden" aria-hidden="true" value={editorValue}></textarea>
</div>

<style>
	@reference '../../app.css';

	.toolbar-button {
		@apply bg-base-100 rounded-none p-2 hover:bg-base-200 cursor-pointer flex items-center justify-center disabled:opacity-35 disabled:hover:bg-base-100 disabled:cursor-auto;
	}

	.toolbar-button-active {
		@apply bg-base-300!;
	}
	.lexical-editor:focus {
		outline: none;
	}

	/* Keep frequent keyboard compensation on a compositor-friendly transform. */
	.lexical-toolbar {
		transform: translate3d(0, 0, 0);
	}

	/* Highlight isn't covered by typography — keep marker readable in the editor. */
	.lexical-editor :global(mark) {
		background-color: color-mix(in oklab, var(--color-warning) 40%, transparent);
		border-radius: 0.15em;
		padding: 0 0.1em;
	}
</style>
