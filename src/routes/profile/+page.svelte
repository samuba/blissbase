<script lang="ts">
	import { getUserSession } from '$lib/rpc/auth.remote';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { routes } from '$lib/routes';
	import { getSupabaseBrowserClient } from '$lib/supabase';

	let isLoggingOut = $state(false);
	const session = await getUserSession();

	async function handleLogout() {
		if (isLoggingOut) return;

		isLoggingOut = true;

		try {
			const supabase = getSupabaseBrowserClient();
			await supabase.auth.signOut();
		} catch (error) {
			console.error(`Logout error:`, error);
		} finally {
			isLoggingOut = false;
		}
	}
</script>


<div class="mx-auto w-full max-w-2xl px-4 py-4 md:py-0 md:pb-10">
	<div class="card bg-base-100 shadow">
		<div class="card-body gap-6">
			<div class="flex items-start gap-4">
				<div class="rounded-2xl bg-primary/12 p-3 text-primary-content">
					<i class="icon-[ph--user-circle] size-8"></i>
				</div>
				<div class="space-y-2">
					<h2 class="text-2xl font-bold">Meine Bereiche</h2>
					<p class="text-base-content/70">
						Hier findest du deine persönlichen Bereiche und schnelle Wege zu deinen wichtigsten Aktionen.
					</p>
				</div>
			</div>

			<div class="alert alert-soft">
				<i class="icon-[ph--check-circle] size-5"></i>
				<span>Du bist eingeloggt als <strong>{session.email}</strong></span>
			</div>

			<div class="flex flex-wrap gap-3">
				<button class="btn" onclick={handleLogout} disabled={isLoggingOut}>
					{#if isLoggingOut}
						<span class="loading loading-spinner loading-sm"></span>
						Wird abgemeldet...
					{:else}
						<i class="icon-[ph--sign-out] size-5"></i>
						Abmelden
					{/if}
				</button>
			</div>
		</div>
	</div>
</div>
