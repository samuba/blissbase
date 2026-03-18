import { resolve } from '$app/paths';

// needs to be a function otherwise wuchale does not pick up the translation
export function getAppTabs() {
	return [
		{
			label: "Entdecken",
			href: resolve("/#header-controls"),
			icon: "icon-[ph--compass]",
			iconActive: "icon-[ph--compass-fill]",
			requireLogin: false
		},
		{
			label: "Erstellen",
			href: resolve("/new"),
			icon: "icon-[ph--plus-circle]",
			iconActive: "icon-[ph--plus-circle-fill]",
			requireLogin: true
		},
		{
			label: "Favoriten",
			href: resolve("/profile/favorites"),
			icon: "icon-[ph--heart]",
			iconActive: "icon-[ph--heart-fill]",
			requireLogin: true
		},
		{
			label: "Profil",
			href: resolve("/profile"),
			icon: "icon-[ph--user-circle]",
			iconActive: "icon-[ph--user-circle-fill]",
			requireLogin: true
		},
		{
			label: "Über",
			href: resolve("/about"),
			icon: "icon-[ph--info]",
			iconActive: "icon-[ph--info-fill]",
			requireLogin: false
		},
	] as const;
}

export function isActiveAppTab(pathname: string, href: string) {
	if (href.includes('#')) {
		return pathname === href.split('#')[0];
	}
	return pathname === href;
}
