import { describe, expect, it } from 'vitest';
import { getLocationHrefs, locationSlugFromHref } from './scrape-todotoday';

const homeHtml = `
<div class="todo-home-locations">
	<a class="todo-home-card" href="https://todo.today/bangkok/">Bangkok</a>
	<a class="todo-home-card" href="https://todo.today/ubud/" aria-label="Check in to Ubud">Ubud</a>
	<a class="todo-home-card" href="/canggu/">Canggu</a>
	<a class="todo-home-card" href="https://todo.today/ubud/">Ubud again</a>
</div>
<a href="https://todo.today/join/">Join</a>
<a href="https://todo.today/locations/">Locations</a>
<a class="tt-bottom-nav__item" href="https://todo.today/koh-phangan/">Home</a>
`;

describe(`Todo.Today location discovery`, () => {
	it(`keeps only home-page location card hrefs, in page order`, () => {
		expect(getLocationHrefs(homeHtml)).toEqual([`https://todo.today/bangkok/`, `https://todo.today/ubud/`, `/canggu/`]);
	});

	it(`reads a location slug from absolute and relative card hrefs`, () => {
		expect(locationSlugFromHref(`https://todo.today/koh-phangan/`)).toBe(`koh-phangan`);
		expect(locationSlugFromHref(`/kuta-lombok/`)).toBe(`kuta-lombok`);
		expect(locationSlugFromHref(`https://todo.today/locations/`)).toBe(`locations`);
		expect(locationSlugFromHref(`https://example.com/ubud/`)).toBeUndefined();
		expect(locationSlugFromHref(`https://todo.today/guides/some-guide/`)).toBeUndefined();
	});
});
