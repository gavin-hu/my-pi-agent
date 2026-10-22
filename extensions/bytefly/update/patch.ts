/**
 * The one way bytefly replaces a host method it has to own.
 *
 * Pi draws two update blocks from methods an extension can reach but cannot turn
 * off: its package list from `DefaultPackageManager.prototype`, and its
 * `Update Available` box from `InteractiveMode.prototype`. Both replacements are
 * the same operation, so the rules that make it safe live here once instead of
 * being restated per surface:
 *
 * - The patch is process-wide, so it is installed at `session_start` and restored
 *   at `session_shutdown`; the record travels on the target under a per-method
 *   `Symbol.for` key, which survives the isolated module caches `lib/` is loaded
 *   with and makes a second registration reuse the first patch.
 * - A restore only puts the original back while the patch is still the method
 *   installed, so a host or another extension that replaced it later keeps its
 *   own version.
 * - A method the host does not have makes the patch inert rather than an error.
 *   The caller's surface then falls back to what the host draws, which is always
 *   correct and merely less styled.
 */

/** One installed patch, and the method it replaced. */
export interface MethodPatch<F> {
	/** The method as it was before the patch; `undefined` when the host lacks it. */
	readonly original: F | undefined;
	/** Put the original back while this patch is still installed; safe to call more than once. */
	restore(): void;
}

/** The marker for one method's patch, stable across isolated module caches. */
function markerFor(method: string): symbol {
	return Symbol.for(`@gavin-hu/my-pi-agent/host-patch/${method}`);
}

/**
 * Replace `target[method]` with `replacement`.
 *
 * `target` is a prototype, a seam a test can supply as a plain object. The
 * returned patch carries the captured original, because a caller usually needs it
 * for something: the package check still serves bytefly's own query, and the
 * release notification is the fallback when bytefly's rendering throws.
 */
export function patchPrototypeMethod<T extends object, K extends keyof T & string>(
	target: T,
	method: K,
	replacement: T[K],
): MethodPatch<T[K]> {
	const marker = markerFor(method);
	const store = target as unknown as Record<symbol, MethodPatch<T[K]> | undefined>;
	const existing = store[marker];
	if (existing) return existing;

	const original = target[method];
	if (typeof original !== "function") return { original: undefined, restore: () => {} };

	const patch: MethodPatch<T[K]> = {
		original,
		restore() {
			if (target[method] === replacement) target[method] = original;
			delete store[marker];
		},
	};
	target[method] = replacement;
	store[marker] = patch;
	return patch;
}
