<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<title>BlissBase</title>
	<meta name="description" content="Hippie Events in deiner Nähe" />
</svelte:head>

{@render children()}
