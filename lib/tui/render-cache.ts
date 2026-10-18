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

	/** Drop the memo; call from the component's `invalidate()`. */
	invalidate(): void {
		this.width = null;
		this.cached = [];
	}
}
