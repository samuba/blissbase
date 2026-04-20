<script lang="ts">
	import { goto } from '$app/navigation';
	import Login from '$lib/components/Login.svelte';
	import { routes } from '$lib/routes';
</script>

<main class="mx-auto w-full max-w-md px-4 py-10">
	<h1 class="mb-4 text-2xl font-semibold">Anmelden</h1>
	<div class="bg-base-100 rounded-lg p-6 shadow">
		<Login  onAuthenticated={() => goto(routes.profile())}/>
	</div>
</main>