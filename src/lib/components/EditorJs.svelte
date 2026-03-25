<script lang="ts">
	import { onMount } from 'svelte';
	import type EditorJS from '@editorjs/editorjs';
	import { debounce, sleep } from '$lib/common';
	import type { RemoteFormField } from '@sveltejs/kit';
	import { localeStore } from '$lib/../locales/localeStore.svelte';
	import {
		normalizeEditorJsInputHtml,
		ParagraphWithSplitPaste,
		paragraphOutputBlocksFromNormalizedHtml
	} from './editorJsNormalizeInputHtml';

	let { field }: {
		field: RemoteFormField<string>;
	} = $props();

	let editor: EditorJS | undefined = $state(undefined);
	let editorEl: HTMLElement | undefined = $state(undefined);

	let editorValue = $derived(field.value() || '');

	onMount(() => {
		let detachSplitPasteCapture: (() => void) | undefined;
		void (async () => {
			try {
				const { default: EditorJS } = await import('@editorjs/editorjs');
			const { default: Header } = await import('@editorjs/header');
			const { default: List } = await import('@editorjs/list');
			const { default: Marker } = await import('@editorjs/marker');
			const { default: EditorJsHtml } = await import('editorjs-html');
			class CustomList extends List {
				override renderSettings() {
					return super.renderSettings().filter(
						(item) =>
							// Here you can filter needed items
							// In my case I need to only support unordered and ordered lists without any new options like 'checklist' or 'start from'
							// But if you want to only disable Checklist you can filter like (item) => item.label !== 'Checklist'
							['Unordered', 'Ordered'].includes(item.label) //  as { label: string } if TS
					);
				}
			}

			const editorJsHtml = EditorJsHtml();
			/* @wc-ignore */
			editor = new EditorJS({
				holder: editorEl,
				tools: {
					paragraph: {
						class: ParagraphWithSplitPaste as unknown as import('@editorjs/editorjs').BlockToolConstructable,
						inlineToolbar: true
					},
					marker: {
						class: Marker
					},
					header: {
						class: Header as unknown as import('@editorjs/editorjs').BlockToolConstructable,
						inlineToolbar: true,
						config: {
							placeholder: 'Überschrift',
							levels: [3],
							defaultLevel: 3
						}
					},
					list: {
						class: CustomList,
						inlineToolbar: true,
						config: {
							defaultStyle: 'unordered'
						},
						toolbox: [
							{ data: { style: 'unordered' } },
							{ data: { style: 'ordered' } }
						]
					},
				},
				i18n: localeStore.locale === 'de' ? {
					messages: {
						ui: {
							blockTunes: {
								toggler: {
									'Click to tune': 'Zum Anpassen klicken',
									'or drag to move': 'oder zum Verschieben ziehen'
								}
							},
							inlineToolbar: {
								converter: {
									'Convert to': 'Umwandeln in'
								}
							},
							toolbar: {
								toolbox: {
									Add: 'Hinzufügen'
								}
							},
							popover: {
								Filter: 'Filter',
								'Nothing found': 'Nichts gefunden',
								'Convert to': 'Umwandeln in'
							}
						},
						toolNames: {
							Text: 'Text',
							Heading: 'Überschrift',
							List: 'Liste',
							'Ordered List': 'Nummerierte Liste',
							'Unordered List': 'Liste',
							Checklist: 'Checkliste',
							Bold: 'Fett',
							Italic: 'Kursiv',
							Marker: 'Hervorheben'
						},
						tools: {
							bold: {
								bold: 'Fett'
							},
							link: {
								'Add a link': 'Link einfügen'
							},
							header: {
								'Heading 1': 'Überschrift 1',
								'Heading 2': 'Überschrift 2',
								'Heading 3': 'Überschrift 3',
								'Heading 4': 'Überschrift 4',
								'Heading 5': 'Überschrift 5',
								'Heading 6': 'Überschrift 6'
							},
							list: {
								Unordered: 'Liste',
								Ordered: 'Nummerierte Liste'
							},
							convertTo: {
								'Convert to': 'Umwandeln in'
							}
						},
						blockTunes: {
							converter: {
								'Convert to': 'Umwandeln in'
							},
							convertTo: {
								'Convert to': 'Umwandeln in'
							},
							delete: {
								Delete: 'Löschen'
							},
							moveUp: {
								'Move up': 'Nach oben'
							},
							moveDown: {
								'Move down': 'Nach unten'
							}
						}
					}
				} : undefined,
				onReady: async () => {
					// Split newlines / <br> into multiple blocks before HTML paste pipeline (import + round-trip).
					const normalized = normalizeEditorJsInputHtml(editorValue);
					// removed br tags: https://github.com/codex-team/editor.js/issues/2800
					await editor?.blocks.renderFromHTML(normalized.replaceAll('<br>', '##br##'));
					await sleep(300);
					const temp = await editor!.save();
					for (const block of temp.blocks) {
						if (block.type === 'paragraph') {
							block.data.text = block.data.text.replaceAll('##br##', '<br>');
						}
					}
					editor?.blocks.render(temp);

					// Editor.js merges single `<p>a<br>b</p>` via `insertContentAtCaretPosition`, skipping `onPaste`.
					const holderEl = editorEl;
					if (holderEl) {
						const onPasteCapture = (e: ClipboardEvent) => {
							const inst = editor;
							if (!inst) return;
							const html = e.clipboardData?.getData(`text/html`) ?? ``;
							if (!html.trim()) return;
							const next = normalizeEditorJsInputHtml(html);
							if (next === html.trim()) return;
							const chunks = paragraphOutputBlocksFromNormalizedHtml(next);
							if (chunks.length < 2) return;
							const idx = inst.blocks.getCurrentBlockIndex();
							const cur = inst.blocks.getBlockByIndex(idx);
							if (!cur || cur.name !== `paragraph` || !cur.isEmpty) return;
							e.preventDefault();
							e.stopImmediatePropagation();
							for (let i = 0; i < chunks.length; i++) {
								inst.blocks.insert(
									`paragraph`,
									chunks[i].data,
									{},
									idx + i,
									i === chunks.length - 1,
									i === 0
								);
							}
						};
						holderEl.addEventListener(`paste`, onPasteCapture, true);
						detachSplitPasteCapture = () =>
							holderEl.removeEventListener(`paste`, onPasteCapture, true);
					}
				},
				onChange: debounce(async () => {
					const blocks = await editor!.save();
					editorValue = editorJsHtml.parse(blocks);
				}, 1000)
			});
			} catch (error) {
				console.error('Failed to load EditorJS:', error);
				throw error;
			}
		})();
		return () => {
			detachSplitPasteCapture?.();
		};
	});
</script>

<div bind:this={editorEl} class="prose-sm textarea w-full sm:pl-0"></div>

<textarea {...field.as('text')} class="hidden peer" aria-hidden="true" value={editorValue}></textarea>

<style>
	@reference '../../app.css';

	:global(.codex-editor__redactor) {
		padding-bottom: 0 !important;
	}

	:global(.ce-toolbar__content) {
		@apply sm:ml-16;
	}

	:global(.ce-block) {
		@apply sm:ml-4;
	}

	:global(.ce-block__content) {
		@apply sm:mr-0 sm:ml-12;
	}

	/*
		Editor.js ships `.codex-editor { z-index: 1 }`, which pins the whole editor under later
		siblings. Use `auto` so only the floating UI below can sit above form fields.
	*/
	:global(.codex-editor) {
		z-index: auto !important;
	}

	/*
		Above TabsNavMobile / sticky nav (z-50) and Editor.js defaults (popover container z-4).
		Below full-screen overlays (e.g. z-100 navigation veil) and Toaster (z-200).
	*/
	:global(.ce-toolbar),
	:global(.ce-toolbox),
	:global(.ce-settings),
	:global(.ce-toolbox),
	:global(.ce-popover),
	:global(.ce-popover__overlay),
	:global(.ce-popover__container),
	:global(.ce-popover__items),
	:global(.ce-popover__item),
	:global(.ce-inline-toolbar) {
		z-index: 60 !important;
	}
</style>
