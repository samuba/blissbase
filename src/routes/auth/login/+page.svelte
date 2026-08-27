<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Login from '$lib/components/Login.svelte';
	import { AUTH_NEXT_QUERY, routes, safeAuthNextPath } from '$lib/routes';

	const nextPath = $derived(
		safeAuthNextPath({
			next: page.url.searchParams.get(AUTH_NEXT_QUERY),
			fallback: routes.profile(),
			origin: page.url.origin,
		}),
	);
</script>

<main class="mx-auto w-full max-w-md px-4 py-10">
	<h1 class="mb-4 text-2xl font-semibold">Anmelden</h1>
	<div class="bg-base-100 rounded-lg p-6 shadow">
		<Login next={nextPath} onAuthenticated={() => goto(nextPath)} />
	</div>
</main>
