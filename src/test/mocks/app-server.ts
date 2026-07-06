export function getRequestEvent() {
	return {
		locals: {
			userId: null,
			supabase: null,
		},
		cookies: {
			get: () => undefined,
			set: () => {},
			delete: () => {},
		},
		url: new URL(`http://localhost`),
		fetch: globalThis.fetch,
	};
}

export const command = () => {};
export const form = () => {};
export const query = () => {};
export const prerender = () => {};
