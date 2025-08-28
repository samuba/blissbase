<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Editor } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';

	let { value = $bindable('') } = $props();

	let element = $state<HTMLDivElement>();
	let editor = $state<Editor>();

	onMount(() => {
		editor = new Editor({
			element: element,
			extensions: [StarterKit],
			editorProps: {
				attributes: {
					class: 'prose prose-sm sm:prose-base w-full textarea rounded-2xl min-w-full'
				}
			},
			content: value,
			onSelectionUpdate: ({ editor: newEditor }) => {
				// force re-render so `editor.isActive` works as expected
				editor = undefined;
				editor = newEditor;
			},
			onUpdate: ({ editor: newEditor }) => {
				// force re-render so `editor.isActive` works as expected
				editor = undefined;
				editor = newEditor;
				value = newEditor.getHTML();
			}
			// Note: you can use `onTransaction` instead of `onSelectionUpdate` and `onUpdate` but it produces an error when using the browser back button.
		});
	});

	$effect(() => {
		// This makes sure if the parent passes in something new it sets Tiptap to use that instead of what it was.
		if (value !== editor?.getHTML()) {
			editor?.commands.setContent(value);
		}
	});

	onDestroy(() => {
		if (editor) {
			editor.destroy();
		}
	});
</script>

{#if editor}
	<ul class="menu menu-horizontal bg-base-200 rounded-box">
		<li
			onclick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
			type="button"
			class:active={editor?.isActive('heading', { level: 1 })}
		>
			<i class="icon-[ph--pencil] size-5"></i>
		</li>
		<li
			onclick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
			type="button"
			class:active={editor?.isActive('heading', { level: 2 })}
			class="size-5"
		>
			<i class="icon-[ph--pencil] size-5"></i>
		</li>
		<li
			onclick={() => editor?.chain().focus().setParagraph().run()}
			type="button"
			class:active={editor?.isActive('paragraph')}
			class="size-5"
		>
			P
		</li>
	</ul>
{/if}

<div bind:this={element} class="" />
<div class="prose prose-sm sm:prose-base"></div>

<style>
	@reference "../../app.css";

	button.active {
		@apply bg-primary text-primary-content;
	}

	/* :global(.tiptap) {
		@apply;
	} */
</style>
