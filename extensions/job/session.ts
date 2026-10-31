/**
 * Per-session liveness markers.
 *
 * Each session owns one registry file per project, but a job is still owned by
 * the session that started it. To tell a live owner from a dead one — so a new
 * session can adopt a dead peer's records instead of reaping them blindly —
 * each session writes a small heartbeat marker (its session id, pid, the process's
 * start time, and last-seen time) beside the registry. Adoption reads those
 * markers, so a live peer's jobs are left alone and a dead peer's are taken
 * over.
 *
 * The heartbeat only ticks while a job runs, because that is when the repaint
 * clock runs: a session that has finished its work stops writing, and its marker
 * ages. That is why age alone is not death — the rule is the roster's own
 * (`lib/session-roster.ts`'s `live` / `quiet` / `gone`), read here over a
 * marker, and *only* `gone` lets another session take anything over. A marker
 * whose process is alive is evidence of an owner, not litter, so pruning keeps
 * it; the start token is what tells an idle session apart from a reused pid.
 *
 * Markers are best-effort: a missing directory or an unwritable file degrades
 * to "no marker", which reads as an owner that is gone — the conservative
 * default for adoption. The rule is pure (`sessionStateOf`) so it is unit-tested
 * without real processes, and `createOwnership` is that rule wired to one
 * runtime's directory, clock, and seams: the state of a peer, this session's own
 * marker, and the pruning of the markers that are left.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type RosterSeams, type RosterState, rosterStateOf } from "../../lib/session-roster.ts";
import { sessionMarkerPath } from "./paths.ts";

/** Prefix shared by every marker file, so log/registry files are never parsed. */
const MARKER_PREFIX = "session-";
const MARKER_SUFFIX = ".json";

/** Heartbeat written by one live session. */
export interface SessionMarker {
	sessionId: string;
	/** Host process pid, checked for liveness before trusting the timestamp. */
	pid: number;
	/**
	 * That process's start time, when the platform can say.
	 *
	 * A pid that is alive may be a different program than the one the marker named, and
	 * nothing cheaper than the start time tells them apart — so this is what keeps a
	 * reused pid from reading as an idle session forever.
	 */
	startToken?: string;
	/** Millisecond timestamp of the last heartbeat. */
	updatedAt: number;
}

export { sessionMarkerPath };

function parseMarker(raw: unknown): SessionMarker | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const marker = raw as Partial<SessionMarker>;
	if (typeof marker.sessionId !== "string" || typeof marker.pid !== "number" || typeof marker.updatedAt !== "number") {
		return undefined;
	}
	return {
		sessionId: marker.sessionId,
		pid: marker.pid,
		...(typeof marker.startToken === "string" && marker.startToken !== "" ? { startToken: marker.startToken } : {}),
		updatedAt: marker.updatedAt,
	};
}

/** Write (or refresh) a session's marker. Failures are non-fatal for the caller. */
export function touchSessionMarker(
	dir: string,
	sessionId: string,
	pid: number,
	now: number,
	startToken?: string,
): void {
	try {
		mkdirSync(dir, { recursive: true });
		const path = sessionMarkerPath(dir, sessionId);
		const tmp = `${path}.tmp`;
		const marker: SessionMarker = {
			sessionId,
			pid,
			...(startToken === undefined ? {} : { startToken }),
			updatedAt: now,
		};
		writeFileSync(tmp, JSON.stringify(marker), "utf-8");
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
		// Best-effort; a leftover marker is reaped when its session is gone.
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
 * What a marker says about its session: `live`, `quiet`, or `gone`.
 *
 * The rule is the roster's, asked over a marker, so `session-bus`, the board's page, and
 * this extension cannot answer "is that session around" three ways. A dead pid is `gone`
 * however fresh the heartbeat; a live pid with an aged heartbeat is `quiet`, which is the
 * ordinary state of a session that has finished its jobs; and a pid that has since been
 * reused is `gone` once the start token disagrees. A missing marker is `gone`: no file is
 * no evidence of an owner.
 */
export function sessionStateOf(
	marker: SessionMarker | undefined,
	now: number,
	ttlMs: number,
	seams: RosterSeams = {},
): RosterState {
	if (marker === undefined) return "gone";
	return rosterStateOf(
		{
			lastSeen: marker.updatedAt,
			// A marker naming no usable process is judged by its heartbeat alone, which is the
			// roster's answer for a record that cannot say which process owns it.
			...(marker.pid > 0 ? { pid: marker.pid } : {}),
			...(marker.startToken === undefined ? {} : { startToken: marker.startToken }),
		},
		now,
		ttlMs,
		seams,
	);
}

/**
 * Delete the markers of sessions that are gone.
 *
 * A marker whose process is alive is kept, including one whose heartbeat has aged: that is
 * what every idle session's marker looks like, and removing it would let a peer adopt a
 * session that is still there. Only a session that has really gone — a dead pid, or a
 * reused one — loses its marker.
 */
export function pruneSessionMarkers(dir: string, now: number, ttlMs: number, seams: RosterSeams = {}): void {
	for (const marker of listSessionMarkers(dir)) {
		if (sessionStateOf(marker, now, ttlMs, seams) === "gone") removeSessionMarker(dir, marker.sessionId);
	}
}

/** What the ownership rule needs from the runtime it serves. */
export interface OwnershipOptions {
	/** The directory the markers sit in. */
	directory(): string;
	/** This session's id; it is never `gone`. */
	sessionId(): string;
	/** The clock the rule is read against. */
	now(): number;
	/** How old a beat may be before the marker's pid is re-checked for reuse. */
	ttlMs(): number;
	/** Whether a pid is still running. */
	alive(pid: number): boolean;
	/** That pid's start time, when the platform can say. */
	startToken(pid: number): string | undefined;
}

/** One runtime's view of the sessions that own jobs. */
export interface Ownership {
	/** `live`, `quiet`, or `gone` for the session that owns a job. */
	state(owner: string): RosterState;
	/** Write this session's marker, naming its process and that process's start time. */
	touch(): void;
	/** Drop the markers of sessions that are gone, keeping a live or a quiet one. */
	prune(): void;
}

/**
 * Wire the rule to one runtime: what a peer's session is, this session's own marker, and
 * the pruning of the markers nobody owns any more.
 */
export function createOwnership(options: OwnershipOptions): Ownership {
	const seams = (): RosterSeams => ({ alive: options.alive, token: options.startToken });
	// This process's token cannot change while the session runs, and on a platform without
	// `ps` the ask costs a failed spawn, so it is asked once and kept, missing or not.
	let token: string | undefined;
	let asked = false;
	const ownToken = (): string | undefined => {
		if (!asked) {
			asked = true;
			token = options.startToken(process.pid);
		}
		return token;
	};
	return {
		state: (owner) =>
			owner === options.sessionId()
				? "live"
				: sessionStateOf(readSessionMarker(options.directory(), owner), options.now(), options.ttlMs(), seams()),
		touch: () => touchSessionMarker(options.directory(), options.sessionId(), process.pid, options.now(), ownToken()),
		prune: () => pruneSessionMarkers(options.directory(), options.now(), options.ttlMs(), seams()),
	};
}
