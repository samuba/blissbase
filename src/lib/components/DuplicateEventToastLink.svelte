<script lang="ts">
	let { href }: { href: string } = $props();
</script>

<a
	href={href}
	target="_blank"
	rel="noopener noreferrer"
	class="link font-semibold"
	data-testid="duplicate-event-link"
>
	Event ansehen
</a>
