/**
 * A per-instance render memo for a component that derives its lines.
 *
 * A `Component`'s `render(width)` runs on every frame Pi draws: `doRender`
 * walks the whole tree, so a frame re-derives every block in the transcript even
 * when only the last line changed. A component whose output is a transform of
 * another component's lines pays that transform per line per frame, which is
 * what makes a long transcript feel slow. This memo makes a repeat frame one
 * comparison.
 *
 * The key is the two things the derived lines depend on:
 *
 * - the width they are laid out at;
 * - the lines they are derived from, compared by identity. Pi's own components
 *   (`Text`, `Box`) cache and return the same array object while their content is
 *   unchanged, so identity is an exact change signal; a renderer that builds a
 *   fresh array on every call simply misses and rebuilds.
 *
 * A component with no inner lines passes `undefined` and caches on its width
 * alone, clearing the memo itself when its own state changes.
 *
 * `invalidate()` drops the memo and must be called from the component's own
 * `invalidate()`: Pi calls that on a theme change (and a renderer's shell is
 * rebuilt on an expand toggle), which is what keeps cached themed strings from
 * surviving a repaint.
 *
 * Value-only: per-instance fields, no module state.
 */

/** A memoized line set: the last width and source, and what they produced. */
export class RenderCache {
	private width: number | null = null;
	private source: readonly string[] | undefined;
	/** The last key's parts, for the value-keyed form; `undefined` until one is set. */
	private parts: readonly unknown[] | undefined;
	private cached: string[] = [];

	/**
	 * The lines from `build()`, rebuilt only when the layout changed.
	 *
	 * `source` is the inner component's rendered lines; `undefined` means the
	 * output is derived from state the caller invalidates instead.
	 */
	lines(width: number, source: readonly string[] | undefined, build: () => string[]): string[] {
		if (this.width === width && this.source === source) return this.cached;
		this.cached = build();
		this.width = width;
		this.source = source;
		return this.cached;
	}

	/**
	 * The lines from `build()`, for a component that derives them from a key.
	 *
	 * The identity form above chains on the inner component's array. A component with no
	 * inner component has nothing to chain on — a header's view and a footer's snapshot are
	 * rebuilt every frame — so it describes its inputs instead, and this compares them:
	 * primitives by value, and anything else by identity (a theme object is the case that
	 * matters, since its strings are what get cached).
	 *
	 * The key is only as complete as the caller makes it: a part left out is a frame that
	 * shows stale lines. Positions are compared, so an undefined part is a real one.
	 */
	keyed(parts: readonly unknown[], build: () => string[]): string[] {
		const previous = this.parts;
		if (
			previous !== undefined &&
			previous.length === parts.length &&
			previous.every((part, at) => part === parts[at])
		) {
			return this.cached;
		}
		this.cached = build();
		this.parts = [...parts];
		return this.cached;
	}

	/** Drop the memo; call from the component's `invalidate()`. */
	invalidate(): void {
		this.width = null;
		this.parts = undefined;
		this.cached = [];
	}
}
