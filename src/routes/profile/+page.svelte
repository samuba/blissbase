<script lang="ts">
	import { getSupabaseBrowserClient } from '$lib/supabase';
	import { routes } from '$lib/routes';
	import { user } from '$lib/user.svelte';
	import { resetPosthogIdentity } from '$lib/posthog';

	let { data } = $props();
	const myPublic = $derived(data.myPublic);
	let isLoggingOut = $state(false);

	async function handleLogout() {
		if (isLoggingOut) return;

		isLoggingOut = true;

		try {
			const supabase = getSupabaseBrowserClient();
			await supabase.auth.signOut();
			resetPosthogIdentity();
		} catch (error) {
			console.error(`Logout error:`, error);
		} finally {
			isLoggingOut = false;
		}
	}
</script>


<div class="mx-auto w-full max-w-2xl px-4 py-4 md:py-0 md:pb-10">
	<div class="card bg-base-100 mt-4 overflow-hidden shadow">
		<ul class="list">
			<li>
				<a href={routes.myEvents()} class="list-row hover:bg-base-200 items-start no-underline">
					<div class="bg-primary/15 text-primary-content flex size-12 shrink-0 items-center justify-center rounded-xl">
						<i class="icon-[ph--calendar-dots] block size-7"></i>
					</div>
					<div class="list-col-grow">
						<h3 class="text-lg font-semibold">Meine Events</h3>
						<p class="text-base-content/80 text-sm leading-relaxed">
							Verwalte deine erstellten Events.
						</p>
					</div>
					<i class="icon-[ph--caret-right] text-base-content/40 size-5 self-center"></i>
				</a>
			</li>
			<li>
				<a href={routes.myOfferings()} class="list-row hover:bg-base-200 items-start no-underline">
					<div class="bg-primary/15 text-primary-content flex size-12 shrink-0 items-center justify-center rounded-xl">
						<i class="icon-[ph--hand-heart] block size-7"></i>
					</div>
					<div class="list-col-grow">
						<h3 class="text-lg font-semibold">Meine Angebote</h3>
						<p class="text-base-content/80 text-sm leading-relaxed">
							Verwalte deine Angebote und aktiviere oder deaktiviere sie.
						</p>
					</div>
					<i class="icon-[ph--caret-right] text-base-content/40 size-5 self-center"></i>
				</a>
			</li>
		</ul>
	</div>

	<div class="card bg-base-100 mt-4 shadow">
		<div class="card-body gap-4">
			<div class="flex items-start gap-3">
				<div class="bg-primary/15 text-primary-content flex size-12 shrink-0 items-center justify-center rounded-xl">
					<i class="icon-[ph--identification-card] block size-7"></i>
				</div>
				<div class="min-w-0 flex-1 space-y-2">
					<h3 class="text-lg font-semibold">Öffentliches Profil</h3>
					<p class="text-base-content/80 text-sm leading-relaxed">
						{#if (myPublic.isPublic && myPublic.slug)}
							Dein öffentliches Profil ist sichtbar unter 
							<a href="https://blissbase.app/@/{myPublic.slug}" class="link">
								blissbase.app/@/{myPublic.slug}
							</a>
						{:else}
							Erstelle dein öffentliches Profil.
						{/if}
					</p>
					<div class="card-actions pt-1 gap-4">
						<a href={routes.editPublicProfile()} class="btn btn-primary">
							{#if myPublic.isPublic && myPublic.slug}
								Profil bearbeiten
							{:else}
								Profil erstellen
							{/if}
						</a>
						{#if myPublic.isPublic && myPublic.slug?.trim()}
							<a href={routes.publicProfile(myPublic.slug)} class="btn">
								<i class="icon-[ph--eye] size-4"></i>
								Profil ansehen
							</a>
						{/if}
					</div>
				</div>
			</div>
		</div>
	</div>

	{#if user.isAdmin}
		<div class="card bg-base-100 mt-4 shadow">
			<div class="card-body gap-4">
				<div class="flex items-start gap-3">
					<div class="bg-primary/15 text-primary-content flex size-12 shrink-0 items-center justify-center rounded-xl">
						<i class="icon-[ph--shield-star] block size-7"></i>
					</div>
					<div class="min-w-0 flex-1 space-y-2">
						<h3 class="text-lg font-semibold">Admin</h3>
						<p class="text-base-content/80 text-sm leading-relaxed">
							Telegram- und WhatsApp-Scraping sowie weitere Admin-Tools.
						</p>
						<div class="card-actions pt-1">
							<a href={routes.admin()} class="btn">
								Admin öffnen
							</a>
						</div>
					</div>
				</div>
			</div>
		</div>
	{/if}

	<div class="card shadow bg-base-100 mt-4">
		<!-- <i class="icon-[ph--check-circle] size-5"></i> -->
		<div class="flex flex-col gap-3 card-body">
			<span>Du bist eingeloggt als <strong>{data.session.email}</strong></span>
			<button class="btn btn-warning w-fit" onclick={handleLogout} disabled={isLoggingOut}>
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
