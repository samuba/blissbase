import { resolve } from '$app/paths';
import { routes } from '$lib/routes';

export function getAppNavItems(): AppNavItem[] {
	return [
		{
			label: /* @wc-include */ `Entdecken`,
			href: resolve(`/#header-controls`),
			icon: `icon-[ph--compass]`,
			iconActive: `icon-[ph--compass-fill]`,
			requireLogin: false,
			isInMoreMenu: false
		},
		{
			label: /* @wc-include */ `Erstellen`,
			href: resolve(`/new`),
			icon: `icon-[ph--plus-circle]`,
			iconActive: `icon-[ph--plus-circle-fill]`,
			requireLogin: true,
			isInMoreMenu: false,
		},
		{
			label: /* @wc-include */ `Favoriten`, 
			href: resolve(`/profile/favorites`),
			icon: `icon-[ph--heart]`,
			iconActive: `icon-[ph--heart-fill]`,
			requireLogin: true,
			isInMoreMenu: false
		},
		{
			label: /* @wc-include */ `Meins`,
			href: resolve(`/profile`),
			icon: `icon-[ph--user-circle]`,
			iconActive: `icon-[ph--user-circle-fill]`,
			requireLogin: true,
			isInMoreMenu: false
		},
		{
			label: /* @wc-include */ `Über`,
			href: resolve(`/about`),
			icon: `icon-[ph--info]`,
			iconActive: `icon-[ph--info-fill]`,
			requireLogin: false,
			isInMoreMenu: true
		},
		{
			label: /* @wc-include */ `FAQ`,
			href: resolve(`/faq`),
			icon: `icon-[ph--question]`,
			iconActive: `icon-[ph--question-fill]`,
			requireLogin: false,
			isInMoreMenu: true
		}
	];
}

export const appNavItems = getAppNavItems();

export function isActiveAppTab(pathname: string, href: string) {
	if (href.startsWith('./')) {
		// happens at SSR
		href = href.slice(1);
	}
	if (href.includes('#')) {
		return pathname === href.split('#')[0];
	}
	if (href === routes.profile()) {
		return pathname === href || (pathname.startsWith(`${href}/`) && pathname !== routes.favorites());
	}
	return pathname === href;
}

type AppNavItem = {
	label: string;
	href: string;
	icon: string;
	iconActive: string;
	requireLogin: boolean;
	isInMoreMenu: boolean;
};
