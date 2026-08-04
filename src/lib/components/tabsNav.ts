import { resolve } from '$app/paths';
import { routes } from '$lib/routes';

export function getAppNavItems(): AppNavItem[] {
	return [
		{
			label: /* @wc-include */ `Events`,
			href: resolve(`/#header-controls`),
			icon: `icon-[ph--calendar-dots]`,
			iconActive: `icon-[ph--calendar-dots-fill]`,
			requireLogin: false
		},
		{
			label: /* @wc-include */ `Angebote`,
			href: routes.offeringsList(),
			icon: `icon-[ph--hand-heart]`,
			iconActive: `icon-[ph--hand-heart-fill]`,
			requireLogin: false
		},
		{
			label: /* @wc-include */ `Favoriten`,
			href: resolve(`/profile/favorites`),
			icon: `icon-[ph--heart]`,
			iconActive: `icon-[ph--heart-fill]`,
			requireLogin: true
		},
		{
			label: /* @wc-include */ `Meins`,
			href: resolve(`/profile`),
			icon: `icon-[ph--user-circle]`,
			iconActive: `icon-[ph--user-circle-fill]`,
			requireLogin: true
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
		const path = href.split('#')[0];
		return pathname === path || pathname === routes.newEvent();
	}
	if (href === routes.profile()) {
		return pathname === href || (pathname.startsWith(`${href}/`) && pathname !== routes.favorites());
	}
	if (href === routes.offeringsList()) {
		return pathname === href || pathname.startsWith(`${href}/`);
	}
	return pathname === href;
}

type AppNavItem = {
	label: string;
	href: string;
	icon: string;
	iconActive: string;
	requireLogin: boolean;
};
