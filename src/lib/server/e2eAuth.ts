import { createHash } from "node:crypto";

export const E2E_OTP_CODE = `123456`;

export function getE2EUserIdForEmail(email: string) {
	const hash = createHash(`sha256`).update(email.trim().toLowerCase()).digest(`hex`);
	return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4000-8000-${hash.slice(12, 24)}`;
}
