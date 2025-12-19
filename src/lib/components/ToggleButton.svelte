<script lang="ts">
    import type { Snippet } from "svelte";

	let {
		checked = $bindable(false),
        children,
        class: className,
        name,
		onchange,
		tooltip,
        ...restProps
	}: {
		checked: boolean;
		children: Snippet;
		class?: string;
		name?: string;
		onchange?: (checked: boolean) => void;
		tooltip?: string;
	} = $props();

	function handleChange(e: Event) {
		onchange?.(!checked);
	}
</script>

<button 
	class={['btn', className, 
		checked && 'active', 
		tooltip && 'tooltip'
	]} 
	onclick={handleChange} 
	data-tip={tooltip}
	{...restProps}>
    {@render children()}
</button>
<input type="checkbox" class="sr-only" name={name} />
