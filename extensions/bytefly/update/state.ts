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

/** The store the header reads and the update lifecycle writes. */
export interface UpdateSource {
	/** The newer published version, or `undefined` when none is known. */
	latest(): string | undefined;
	/** Record a version, or clear it with no argument. */
	set(latest?: string): void;
}

/**
 * What one explicit re-check found. The background check reports nothing — nobody
 * asked — so this vocabulary exists only for `/bytefly update`, where a failure or
 * a skip is an answer rather than silence.
 */
export type UpdateOutcome =
	| { kind: "offline" }
	| { kind: "failed" }
	| { kind: "current"; latest: string }
	| { kind: "available"; latest: string };

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
