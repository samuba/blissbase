<script lang="ts">
	import { onMount } from 'svelte';
	import type EditorJS from '@editorjs/editorjs';
	import { debounce, sleep } from '$lib/common';

	let { value = $bindable('Beschreibung deines Events') } = $props();

	let editor: EditorJS | undefined = $state(undefined);
	let editorEl: HTMLElement | undefined = $state(undefined);

	onMount(async () => {
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
			editor = new EditorJS({
				holder: editorEl,
				tools: {
					marker: {
						class: Marker
					},
					header: {
						class: Header,
						inlineToolbar: true,
						config: {
							placeholder: 'Überschrift',
							levels: [2, 3, 4],
							defaultLevel: 2
						}
					},
					list: {
						class: CustomList,
						inlineToolbar: true,
						config: {
							defaultStyle: 'unordered'
						},
						toolbox: [
							{
								data: { style: 'ordered' }
							},
							{
								data: { style: 'unordered' }
							}
						]
					}
				},
				i18n: {
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
				},
				onReady: async () => {
					// removed br tags: https://github.com/codex-team/editor.js/issues/2800
					editor?.blocks.renderFromHTML(value.replaceAll('<br>', '##br##'));
					await sleep(100);
					const temp = await editor?.save()!;
					for (const block of temp.blocks) {
						if (block.type === 'paragraph') {
							block.data.text = block.data.text.replaceAll('##br##', '<br>');
						}
					}
					editor?.blocks.render(temp);
					// todo: replace br tags with <brrr> tags, render html, save as json, replace <brrr> tags with <br> tags in json, render json
				},
				onChange: debounce(async () => {
					console.log(await editor?.save());
					value = editorJsHtml.parse(await editor?.save()!);
				}, 1000)
			});
		} catch (error) {
			console.error('Failed to load EditorJS:', error);
			throw error;
		}
	});
</script>

<div bind:this={editorEl} class="prose-sm textarea w-full pl-4 md:pl-0"></div>

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

	:global(.codex-editor) {
		/* @apply bg-base-200; */
	}
</style>
