<script lang="ts">
	import { getSupabaseBrowserClient } from '$lib/supabase';
	import { routes } from '$lib/routes';
	import { user } from '$lib/user.svelte';
	import { resetPosthogIdentity } from '$lib/posthog';

	let { data } = $props();
	const myPublic = $derived(data.myPublic);
	const hasPublicProfile = $derived(Boolean(myPublic.isPublic && myPublic.slug?.trim()));
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
				<div class="list-row hover:bg-base-200 relative items-start">
					<div class="bg-primary/15 text-primary-content flex size-12 shrink-0 items-center justify-center rounded-xl">
						<a
							href={routes.editPublicProfile()}
							class="absolute inset-0"
							aria-label={hasPublicProfile ? `Profil bearbeiten` : `Profil erstellen`}
						></a>
						<i class="icon-[ph--identification-card] block size-7"></i>
					</div>
					<div class="list-col-grow">
						<h3 class="text-lg font-semibold">Öffentliches Profil</h3>
						{#if hasPublicProfile && myPublic.slug}
							<p class="text-base-content/80 flex flex-wrap items-center text-sm leading-relaxed">
								Dein öffentliches Profil ist sichtbar unter
								<a href={routes.publicProfile(myPublic.slug)} class="link relative z-10 pl-1">
									blissbase.app/@/{myPublic.slug}
								</a>
							</p>
						{:else}
							<p class="text-base-content/80 text-sm leading-relaxed">
								Erstelle dein öffentliches Profil.
							</p>
						{/if}
					</div>
					<i class="icon-[ph--caret-right] text-base-content/40 size-5 self-center"></i>
				</div>
			</li>
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
			{#if user.isAdmin}
				<li>
					<a href={routes.admin()} class="list-row hover:bg-base-200 items-start no-underline">
						<div class="bg-primary/15 text-primary-content flex size-12 shrink-0 items-center justify-center rounded-xl">
							<i class="icon-[ph--shield-star] block size-7"></i>
						</div>
						<div class="list-col-grow">
							<h3 class="text-lg font-semibold">Admin</h3>
							<p class="text-base-content/80 text-sm leading-relaxed">
								Telegram- und WhatsApp-Scraping sowie weitere Admin-Tools.
							</p>
						</div>
						<i class="icon-[ph--caret-right] text-base-content/40 size-5 self-center"></i>
					</a>
				</li>
			{/if}
		</ul>
	</div>

	<div class="card bg-base-100 mt-4 overflow-hidden shadow">
		<ul class="list">
			<li>
				<div class="list-row">
					<div class="list-col-grow flex flex-col gap-3">
						<span class="text-base">Du bist eingeloggt als <strong>{data.session.email}</strong></span>
						<button class="btn w-fit" onclick={handleLogout} disabled={isLoggingOut}>
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
			</li>
		</ul>
	</div>
</div>
