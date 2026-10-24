/**
 * Where a surface reads the newest published version this load found, and what an
 * explicit re-check reported.
 *
 * The check resolves after the session started, so the header cannot be handed
 * the value up front: it reads through this store on every apply, and the
 * update registration re-installs the header once the value arrives. The store
 * is created once per load by the composition root — no module state — and
 * cleared on shutdown, so a reload starts from nothing.
 */

import type { PackageUpdate } from "./types.ts";

/** The store the header reads and the update lifecycle writes. */
export interface UpdateSource {
	/** The newer published version, or `undefined` when none is known. */
	latest(): string | undefined;
	/** Record a version, or clear it with no argument. */
	set(latest?: string): void;
}

/**
 * What one explicit update reported. The background check reports nothing — nobody
 * asked — so this vocabulary exists only for `/bytefly update` and
 * `/bytefly upgrade`, where a failure, a skip, or a refusal is an answer rather
 * than silence.
 */
export type UpdateOutcome =
	| { kind: "offline" }
	| { kind: "failed" }
	| { kind: "update-failed"; reason: string }
	| { kind: "updated"; pending: boolean }
	| { kind: "current" }
	| { kind: "available"; updates: readonly PackageUpdate[]; ownLatest?: string };

/** A store holding at most one version. */
export function createUpdateState(): UpdateSource {
	let latest: string | undefined;
	return {
		latest: () => latest,
		set(next) {
			latest = next || undefined;
		},
	};
}

/**
 * Record a version in the store and repaint the surface that reads it.
 *
 * The comparison is what keeps this cheap and quiet: a check that finds the same
 * version again must not re-install the header, and clearing an unknown version
 * must still clear the marker. `onUpdate` is the surface's repaint hook, so a
 * registration that has no mounted surface can omit it.
 */
export function paintLatest(store: UpdateSource, latest: string | undefined, onUpdate?: () => void): void {
	if (store.latest() === latest) return;
	store.set(latest);
	onUpdate?.();
}
