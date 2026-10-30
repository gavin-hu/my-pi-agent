/**
 * The port band the loopback pages share, and the number a project keeps in it.
 *
 * `serve` takes a session's one port from here, so every page that session serves
 * clusters where a person's bookmarks already point. The band is one product decision,
 * stated here once: a number repeated in each extension's config is several chances to
 * move one of them, and nothing would notice until a bookmark landed outside the range.
 *
 * A project's number is its repository key hashed into the band rather than a fresh
 * draw, so a session that starts again lands on the port its bookmark names; two
 * repositories take two numbers without a setting. `serve.port` overrides it.
 *
 * A pick is a guess, not a reservation. `serveHttp` binds it and falls back to whatever
 * free port the OS gives, so a port another process holds — or another project's hash
 * landing in the same slot — costs a retry rather than a start.
 */

import { createHash } from "node:crypto";

/** Base of the per-project port range. */
export const PORT_BASE = 4780;

/** Number of ports in the per-project range. */
export const PORT_RANGE = 1000;

/** The port a project prefers: its repository key hashed into `PORT_BASE`–`PORT_BASE + PORT_RANGE - 1`. */
export function projectPort(repoKey: string): number {
	const digest = createHash("sha256").update(repoKey).digest();
	return PORT_BASE + (digest.readUInt32BE(0) % PORT_RANGE);
}
