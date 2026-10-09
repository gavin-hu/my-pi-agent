/**
 * Filesystem path helpers for the jobs extension.
 *
 * A project's job directory holds one registry file per session, one heartbeat
 * marker per session, and one log plus one status file per job. Deriving every
 * name here keeps the hash and the prefixes in one place, so `registry.ts` and
 * `session.ts` cannot drift apart.
 */

import { createHash } from "node:crypto";
import { join } from "node:path";

/** Short, filename-safe hash of a session id (arbitrary characters cannot escape the directory). */
export function hashSessionId(sessionId: string): string {
	return createHash("sha1").update(sessionId).digest("hex").slice(0, 16);
}

/** Path of a session's heartbeat marker inside `dir`. */
export function sessionMarkerPath(dir: string, sessionId: string): string {
	return join(dir, `session-${hashSessionId(sessionId)}.json`);
}

/** Path of a session's registry file inside `dir`. */
export function registryPathFor(dir: string, sessionId: string): string {
	return join(dir, `registry-${hashSessionId(sessionId)}.json`);
}

/** Path of a job's exit-status file inside `dir`. */
export function statusPathFor(dir: string, id: string): string {
	return join(dir, `${id}.status`);
}
