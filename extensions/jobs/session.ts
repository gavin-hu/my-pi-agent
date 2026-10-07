/**
 * Per-session liveness markers.
 *
 * A job registry is shared by every Pi session in a project, but a job is owned
 * by the session that started it. To tell a live owner from a dead one, each
 * session writes a small heartbeat marker (its session id, pid, and last-seen
 * time) beside the registry while it runs jobs. Reconciliation reads those
 * markers, so a new session reaps only jobs whose owner is gone instead of
 * killing every live non-detached job it finds.
 *
 * Markers are best-effort: a missing directory or an unwritable file degrades
 * to "owner dead", which is the pre-existing conservative default. The liveness
 * rule is pure (`isSessionAlive`) so it is unit-tested without real processes.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Prefix shared by every marker file, so log/registry files are never parsed. */
const MARKER_PREFIX = "session-";
const MARKER_SUFFIX = ".json";

/** Heartbeat written by one live session. */
export interface SessionMarker {
	sessionId: string;
	/** Host process pid, checked for liveness before trusting the timestamp. */
	pid: number;
	/** Millisecond timestamp of the last heartbeat. */
	updatedAt: number;
}

/** Hash the session id so arbitrary characters cannot escape the directory. */
function markerHash(sessionId: string): string {
	return createHash("sha1").update(sessionId).digest("hex").slice(0, 16);
}

/** Path of the marker file for `sessionId` inside `dir`. */
export function sessionMarkerPath(dir: string, sessionId: string): string {
	return join(dir, `${MARKER_PREFIX}${markerHash(sessionId)}${MARKER_SUFFIX}`);
}

function parseMarker(raw: unknown): SessionMarker | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const marker = raw as Partial<SessionMarker>;
	if (
		typeof marker.sessionId !== "string" ||
		typeof marker.pid !== "number" ||
		typeof marker.updatedAt !== "number"
	) {
		return undefined;
	}
	return { sessionId: marker.sessionId, pid: marker.pid, updatedAt: marker.updatedAt };
}

/** Write (or refresh) a session's marker. Failures are non-fatal for the caller. */
export function touchSessionMarker(dir: string, sessionId: string, pid: number, now: number): void {
	try {
		mkdirSync(dir, { recursive: true });
		const path = sessionMarkerPath(dir, sessionId);
		const tmp = `${path}.tmp`;
		writeFileSync(tmp, JSON.stringify({ sessionId, pid, updatedAt: now } satisfies SessionMarker), "utf-8");
		renameSync(tmp, path);
	} catch {
		// A marker is best-effort; a missing one reads as a dead owner.
	}
}

/** Read a session's marker, or `undefined` when missing or malformed. */
export function readSessionMarker(dir: string, sessionId: string): SessionMarker | undefined {
	try {
		return parseMarker(JSON.parse(readFileSync(sessionMarkerPath(dir, sessionId), "utf-8")));
	} catch {
		return undefined;
	}
}

/** Remove a session's marker; missing files and failures are ignored. */
export function removeSessionMarker(dir: string, sessionId: string): void {
	try {
		const path = sessionMarkerPath(dir, sessionId);
		if (existsSync(path)) unlinkSync(path);
	} catch {
		// Best-effort; a leftover marker expires on its own.
	}
}

/** Every valid marker currently on disk. */
export function listSessionMarkers(dir: string): SessionMarker[] {
	const markers: SessionMarker[] = [];
	try {
		for (const entry of readdirSync(dir)) {
			if (!entry.startsWith(MARKER_PREFIX) || !entry.endsWith(MARKER_SUFFIX)) continue;
			try {
				const parsed = parseMarker(JSON.parse(readFileSync(join(dir, entry), "utf-8")));
				if (parsed) markers.push(parsed);
			} catch {
				// Skip a malformed marker.
			}
		}
	} catch {
		// A missing directory has no markers.
	}
	return markers;
}

/**
 * Whether a marker still represents a live session: it must exist, its pid must
 * be alive, and its heartbeat must be within `ttlMs`. A missing marker is dead.
 */
export function isSessionAlive(
	marker: SessionMarker | undefined,
	now: number,
	ttlMs: number,
	isAlive: (pid: number) => boolean,
): boolean {
	if (!marker) return false;
	if (marker.pid > 0 && !isAlive(marker.pid)) return false;
	return now - marker.updatedAt <= ttlMs;
}

/** Delete markers whose owner is no longer alive. */
export function pruneSessionMarkers(
	dir: string,
	now: number,
	ttlMs: number,
	isAlive: (pid: number) => boolean,
): void {
	for (const marker of listSessionMarkers(dir)) {
		if (!isSessionAlive(marker, now, ttlMs, isAlive)) removeSessionMarker(dir, marker.sessionId);
	}
}
