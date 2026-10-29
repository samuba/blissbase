import { describe, expect, it } from "vitest";
import { isBearerTokenAuthorized } from "$lib/server/bearerAuth";

describe(`isBearerTokenAuthorized`, () => {
	it(`accepts a matching bearer token`, () => {
		expect(
			isBearerTokenAuthorized({
				authorization: `Bearer weekly-secret`,
				token: `weekly-secret`,
			}),
		).toBe(true);
	});

	it(`accepts a case-insensitive Bearer scheme`, () => {
		expect(
			isBearerTokenAuthorized({
				authorization: `bearer weekly-secret`,
				token: `weekly-secret`,
			}),
		).toBe(true);
	});

	it(`rejects a missing header, a wrong token, and a missing env token`, () => {
		expect(
			isBearerTokenAuthorized({
				authorization: null,
				token: `weekly-secret`,
			}),
		).toBe(false);
		expect(
			isBearerTokenAuthorized({
				authorization: `Bearer wrong`,
				token: `weekly-secret`,
			}),
		).toBe(false);
		expect(
			isBearerTokenAuthorized({
				authorization: `Bearer weekly-secret`,
				token: undefined,
			}),
		).toBe(false);
		expect(
			isBearerTokenAuthorized({
				authorization: `Bearer weekly-secret`,
				token: ``,
			}),
		).toBe(false);
	});

	it(`rejects a different-length token and a token with a prefix or suffix`, () => {
		expect(
			isBearerTokenAuthorized({
				authorization: `Bearer weekly-secret-extra`,
				token: `weekly-secret`,
			}),
		).toBe(false);
		expect(
			isBearerTokenAuthorized({
				authorization: `Bearer weekly`,
				token: `weekly-secret`,
			}),
		).toBe(false);
		expect(
			isBearerTokenAuthorized({
				authorization: `Token weekly-secret`,
				token: `weekly-secret`,
			}),
		).toBe(false);
	});
});
