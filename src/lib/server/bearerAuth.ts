import { timingSafeEqual } from "node:crypto";

/**
 * True when `Authorization` is `Bearer <token>` and the token matches.
 * An empty expected token is never authorized.
 *
 * @example
 * isBearerTokenAuthorized({ authorization: `Bearer secret`, token: `secret` })
 */
export function isBearerTokenAuthorized({ authorization, token }: { authorization: string | null; token: string | undefined }) {
	const expected = token ?? ``;
	if (!expected) return false;

	return timingSafeEqualString(bearerToken(authorization), expected);
}

function bearerToken(authorization: string | null) {
	if (!authorization) return ``;
	const [scheme, value, ...rest] = authorization.split(` `);
	if (rest.length || scheme?.toLowerCase() !== `bearer`) return ``;
	return value ?? ``;
}

/** `timingSafeEqual` requires equal lengths, so pad before comparing. */
function timingSafeEqualString(a: string, b: string) {
	const aBuf = Buffer.from(a);
	const bBuf = Buffer.from(b);
	const length = Math.max(aBuf.length, bBuf.length, 1);
	const aPadded = Buffer.alloc(length);
	const bPadded = Buffer.alloc(length);
	aBuf.copy(aPadded);
	bBuf.copy(bPadded);
	return timingSafeEqual(aPadded, bPadded) && aBuf.length === bBuf.length;
}
