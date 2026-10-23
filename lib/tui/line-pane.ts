/**
 * A scrollable text pane: the log tail a job screen opens, the match list a
 * watcher screen opens.
 *
 * Both screens embed the same pane — an open row's id, a buffer of already
 * sanitized lines, a scroll offset that follows the tail until the user scrolls
 * away from it, a "showing last N" subtitle, and one dim range row — so the
 * state machine lives here once. The screen owns rendering, the visible row
 * budget, and `requestRender`; the pane owns only the state and the keys that
 * move it.
 *
 * Value-only: a class with instance state, no module-level state.
 */

import { clampScroll, navigateScroll } from "./cursor.ts";

/** A patch for the pane's contents; each field given replaces that field. */
export interface PaneSource {
	/** Title shown after the pane's prefix, e.g. `j1 build`. */
	title?: string;
	/** The lines, newest last. */
	lines?: string[];
	/** The dim subtitle line, e.g. the log file path. Already sanitized. */
	subtitle?: string;
	/** Whether earlier lines exist beyond the loaded window. */
	more?: boolean;
}

/** Whether two line buffers are identical. */
function sameLines(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) return false;
	for (let index = 0; index < a.length; index++) {
		if (a[index] !== b[index]) return false;
	}
	return true;
}

/** The scrollable text pane both the job and watch screens embed. */
export class LinePane {
	/** Id of the row whose pane is open; `""` when the pane is closed. */
	id = "";
	/** First visible line. */
	scroll = 0;
	/** Rows shown at once; the screen sets this from `fitRows` each render. */
	visible = 1;
	/** Whether the view is parked at the tail; set false once the user scrolls up. */
	follow = true;
	/**
	 * Whether this pane follows its tail. A log does; a prose or list pane does not:
	 * it opens at the top and never reports `following`/`paused`.
	 */
	tail = true;

	private buffer: string[] = [];
	private label = "";
	private subtitle: string | undefined;
	private more = false;

	/** Lines loaded into the pane, oldest first. */
	get lines(): readonly string[] {
		return this.buffer;
	}

	/** Loaded line count. */
	get count(): number {
		return this.buffer.length;
	}

	/** The furthest the view can scroll while keeping a full window. */
	get maxScroll(): number {
		return Math.max(0, this.buffer.length - this.visible);
	}

	/** Open the pane on a row, reset to the tail for a log, or to the top for prose. */
	open(id: string, source: PaneSource, tail = true): void {
		this.id = id;
		this.buffer = [];
		this.label = "";
		this.subtitle = undefined;
		this.more = false;
		this.scroll = 0;
		this.tail = tail;
		this.follow = tail;
		this.update(source);
		if (!tail) {
			this.follow = false;
			this.scroll = 0;
		}
	}

	/** Close the pane and drop its buffer. */
	close(): void {
		this.id = "";
		this.buffer = [];
		this.label = "";
		this.subtitle = undefined;
		this.more = false;
		this.scroll = 0;
		this.follow = true;
		this.tail = true;
	}

	/**
	 * Replace the given fields.
	 *
	 * Returns whether anything visible changed, so a caller polling the pane
	 * every 500ms can skip a repaint — and leave the user's scroll alone — when
	 * the buffer is byte-identical.
	 */
	update(source: PaneSource): boolean {
		const titleChanged = source.title !== undefined && source.title !== this.label;
		const linesChanged = source.lines !== undefined && !sameLines(source.lines, this.buffer);
		const moreChanged = source.more !== undefined && source.more !== this.more;
		const subtitleChanged = source.subtitle !== undefined && source.subtitle !== this.subtitle;

		if (source.title !== undefined) this.label = source.title;
		if (source.lines !== undefined) this.buffer = source.lines;
		if (source.more !== undefined) this.more = source.more;
		if (source.subtitle !== undefined) this.subtitle = source.subtitle;

		// Follow the tail; a paused view keeps its place but never past the end.
		if (this.follow) this.scroll = this.maxScroll;
		else this.scroll = Math.min(this.scroll, this.maxScroll);

		return titleChanged || linesChanged || moreChanged || subtitleChanged;
	}

	/** The header label: the pane prefix, and the row's title when it has one. */
	title(prefix: string): string {
		return this.label ? `${prefix} · ${this.label}` : prefix;
	}

	/**
	 * The dim subtitle: the source (a log path), the loaded-window note, and
	 * whether the view is following. Empty when there is nothing to say.
	 */
	subtitleLine(): string {
		const parts: string[] = [];
		if (this.subtitle) parts.push(this.subtitle);
		if (this.more && this.buffer.length > 0) parts.push(`showing last ${this.buffer.length} lines`);
		if (this.tail && this.buffer.length > 0) parts.push(this.follow ? "following" : "paused");
		return parts.join(" · ");
	}

	/** The visible half-open line range, clamped to the buffer. */
	window(): { start: number; end: number } {
		const start = Math.min(Math.max(0, this.scroll), this.maxScroll);
		return { start, end: Math.min(this.buffer.length, start + this.visible) };
	}

	/** Scroll to `next`, clamped; leaving the tail clears `follow`. */
	setScroll(next: number): void {
		this.scroll = clampScroll(next, this.buffer.length, this.visible);
		this.follow = this.scroll >= this.maxScroll;
	}

	/**
	 * Adopt a new visible height for the coming render: clamp the scroll into
	 * range, and re-park a following view at the tail. Does not touch `follow`.
	 */
	fit(visible: number): void {
		this.visible = visible;
		this.scroll = clampScroll(this.scroll, this.buffer.length, this.visible);
		if (this.follow) this.scroll = this.maxScroll;
	}

	/** Apply a scroll key; `false` when the key is not one the pane consumes. */
	handleKey(data: string): boolean {
		const next = navigateScroll(data, this.scroll, this.buffer.length, this.visible);
		if (next !== undefined) {
			this.setScroll(next);
			return true;
		}
		if (data === "g") {
			this.setScroll(0);
			return true;
		}
		if (data === "G") {
			this.setScroll(this.maxScroll);
			return true;
		}
		return false;
	}
}
