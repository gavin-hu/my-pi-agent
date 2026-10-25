/**
 * The bearer token a loopback page carries in its URL.
 *
 * Any page a browser can open is a page any local process can call, so the token
 * is the only thing standing between a served surface and a stranger's `fetch`:
 * it is 128 random bits, minted once per server, and it is compared in constant
 * time. Both halves live here rather than in each extension, because a page that
 * mints its own secret and a page that verifies one another way is exactly the
 * drift this directory exists to prevent.
 *
 * The comparison digests both sides first, so a wrong-length guess costs the same
 * as a wrong-value one and the length of the real token is not observable.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Bytes of entropy per token. Hex-encoded, so a token is twice this many characters. */
export const TOKEN_BYTES = 16;

/** One fresh 128-bit token, as hex. */
export function mintToken(): string {
	return randomBytes(TOKEN_BYTES).toString("hex");
}

/**
 * Whether `given` is the token `expected`.
 *
 * An empty `expected` never matches: a caller that failed to mint one must not
 * accept the empty string a request without a token presents.
 */
export function tokenMatches(expected: string, given: string): boolean {
	if (expected === "") return false;
	return timingSafeEqual(sha256Of(expected), sha256Of(given));
}

function sha256Of(value: string): Buffer {
	return createHash("sha256").update(value).digest();
}
