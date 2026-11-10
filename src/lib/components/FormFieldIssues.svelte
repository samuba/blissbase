<script lang="ts">
	import type { RemoteFormIssue } from "$app/server";

	type Props = {
		field: {
			issues?: () => RemoteFormIssue[] | undefined;
			allIssues?: () => RemoteFormIssue[] | undefined;
		};
		class?: string;
	};

	let { field, class: className }: Props = $props();

	let issues: RemoteFormIssue[] | undefined = $derived((field?.issues?.()?.length ?? 0 > 0) ? field?.issues?.() : field?.allIssues?.());
</script>

{#if issues?.length}
	<div class={[`flex flex-col gap-1`, className]}>
		{#each issues as issue, i (`${issue.message}-${i}`)}
			<div class="text-xs text-red-600">{issue.message}</div>
		{/each}
	</div>
{/if}
