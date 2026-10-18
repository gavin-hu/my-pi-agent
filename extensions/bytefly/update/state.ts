/**
 * Where a surface reads the newest published version this load found.
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
