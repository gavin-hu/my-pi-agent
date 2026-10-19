/**
 * Where a surface reads the package updates this load found.
 *
 * The check resolves after the session started, so the header cannot be handed
 * the value up front: it reads through this store on every apply, and the update
 * registration re-installs the header once the value arrives. The store is
 * created once per load by the composition root — no module state — and
 * cleared on shutdown, so a reload starts from nothing.
 *
 * The list feeds the notice; `ownLatest` feeds the header marker and is this
 * package's new version only, never another package's.
 */

import type { PackageUpdate } from "./types.ts";

/** The store the header and the update lifecycle share. */
export interface UpdateSource {
	/** Every package Pi reports as updateable. */
	updates(): readonly PackageUpdate[];
	/** This package's new version, or `undefined` when it is not one of them. */
	ownLatest(): string | undefined;
	/** Replace the snapshot, or clear it with no arguments. */
	set(updates?: readonly PackageUpdate[], ownLatest?: string): void;
}

/** A store holding one update snapshot. */
export function createUpdateState(): UpdateSource {
	let updates: readonly PackageUpdate[] = [];
	let ownLatest: string | undefined;
	return {
		updates: () => updates,
		ownLatest: () => ownLatest,
		set(next, latest) {
			updates = next ?? [];
			ownLatest = latest || undefined;
		},
	};
}
