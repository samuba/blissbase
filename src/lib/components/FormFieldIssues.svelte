<script lang="ts">
	import type { RemoteFormField } from '@sveltejs/kit';

	let { field }: { field: RemoteFormField<string | string[] | boolean | File[] | number> } = $props();
</script>

{#if field.issues()?.length}
	<div class="flex flex-col gap-1">
		{#each field.issues() as issue, i (`${issue.message}-${i}`)}
			<div class="text-red-600 text-xs">{issue.message}</div>
		{/each}
	</div>
{/if}
