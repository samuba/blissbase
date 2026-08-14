<script lang="ts" module>
	import type { RemoteFormField } from "@sveltejs/kit";
	import type { PublicProfileSocialLinks } from "$lib/rpc/profile.common";

	export type CreateFlowLoadedProfile = {
		displayName?: string | null;
		bio?: string | null;
		profileImageUrl?: string | null;
		bannerImageUrl?: string | null;
		socialLinks?: PublicProfileSocialLinks | null;
	} | null;

	export type CreateFlowProfileRemoteFields = {
		displayName: RemoteFormField<string>;
		profileImageUrl: RemoteFormField<string>;
		bannerImageUrl: RemoteFormField<string>;
		bio: RemoteFormField<string>;
		socialLinks: {
			set: (value: PublicProfileSocialLinks) => unknown;
			issues?: () => unknown[] | undefined;
			allIssues?: () => unknown[] | undefined;
		};
	};
</script>

<script lang="ts">
	import LexicalEditor from "$lib/components/LexicalEditor.svelte";
	import FormFieldIssues from "$lib/components/FormFieldIssues.svelte";
	import ProfileImageCropInput from "$lib/components/ProfileImageCropInput.svelte";
	import PublicProfileSocialLinksEditor from "$lib/components/PublicProfileSocialLinksEditor.svelte";
	import type { ComponentProps } from "svelte";

	let {
		fields,
		profile,
		socialLinks = $bindable(),
		profileSocialLinkError = ``,
		hidden = false,
		requireSocialLink = true,
		onDirty,
		onProfileImageBusyChange,
		onBannerImageBusyChange,
		revalidate,
	}: {
		fields: CreateFlowProfileRemoteFields;
		profile: CreateFlowLoadedProfile;
		socialLinks: PublicProfileSocialLinks;
		profileSocialLinkError?: string;
		hidden?: boolean;
		requireSocialLink?: boolean;
		onDirty?: () => void;
		onProfileImageBusyChange?: (busy: boolean) => void;
		onBannerImageBusyChange?: (busy: boolean) => void;
		revalidate: () => void | Promise<void>;
	} = $props();

	const missingDisplayName = $derived(!profile?.displayName?.trim());
	const missingProfileImageUrl = $derived(!profile?.profileImageUrl?.trim());
	const missingBannerImageUrl = $derived(!profile?.bannerImageUrl?.trim());
	const missingBio = $derived(!profile?.bio?.trim());
	const missingSocialLinks = $derived(!profile?.socialLinks?.some((link) => link.value?.trim()));
</script>

<section class={[`flex flex-col gap-5`, hidden && `hidden`]} data-wizard-step="profile">
	<div class="grid gap-5 sm:grid-cols-2">
		<fieldset class={[`fieldset`, !missingDisplayName && `hidden`]}>
			<input
				class="input peer w-full"
				data-testid="profile-name-input"
				{...fields.displayName.as(`text`)}
				value={profile?.displayName ?? ``}
				autocomplete="name"
				required
			/>
			<legend class="fieldset-legend peer-aria-invalid:text-red-600">Dein Name *</legend>
			<FormFieldIssues field={fields.displayName} />
		</fieldset>
	</div>

	<div class={[`grid gap-6 sm:grid-cols-2`, !missingProfileImageUrl && !missingBannerImageUrl && `hidden`]}>
		<ProfileImageCropInput
			class={!missingProfileImageUrl ? `hidden` : ``}
			kind="profile"
			field={fields.profileImageUrl}
			initialUrl={profile?.profileImageUrl ?? ``}
			onBusyChange={(busy) => {
				onProfileImageBusyChange?.(busy);
				if (busy) onDirty?.();
			}}
		/>

		<ProfileImageCropInput
			class={!missingBannerImageUrl ? `hidden` : ``}
			kind="banner"
			field={fields.bannerImageUrl}
			initialUrl={profile?.bannerImageUrl ?? ``}
			onBusyChange={(busy) => {
				onBannerImageBusyChange?.(busy);
				if (busy) onDirty?.();
			}}
		/>
	</div>

	<fieldset class={[`fieldset`, !missingBio && `hidden`]} data-testid="profile-bio-editor">
		<LexicalEditor
			field={fields.bio}
			value={profile?.bio ?? ``}
			placeholder="Erzähl etwas über dich…"
			{onDirty}
		/>
		<legend class="fieldset-legend peer-aria-invalid:text-red-600">Profilbeschreibung</legend>
		<FormFieldIssues field={fields.bio} />
	</fieldset>

	<fieldset class={[`fieldset`, !missingSocialLinks && `hidden`]}>
		<legend class="fieldset-legend">{requireSocialLink ? `Social Links *` : `Social Links`}</legend>
		<PublicProfileSocialLinksEditor
			bind:socialLinks
			field={fields.socialLinks as ComponentProps<typeof PublicProfileSocialLinksEditor>["field"]}
			markDirty={onDirty}
			{revalidate}
		/>
		{#if profileSocialLinkError}
			<p class="text-error text-sm">{profileSocialLinkError}</p>
		{/if}
	</fieldset>
</section>
