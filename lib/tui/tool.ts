/**
 * The shared tool-transcript kit: a call title, the call line a renderer draws
 * with it, the failure line a result shows before its body, the expand hint, and
 * the running timer.
 *
 * Every extension's `renderCall` / `renderResult` used to repeat the same four
 * idioms — a bold `toolTitle`, a raw `result.content[0]`, a hand-built
 * `… more` hint, and a local elapsed format. This module is the one place those
 * live, so a rejection is sanitized everywhere, a long call line clips instead
 * of wrapping into the railed body, and a duration reads the same in every
 * block.
 *
 * Value-only: pure functions, constants, and a component class whose mutable
 * state is the string the caller passes in. The running timer writes only the
 * caller's `context.state`, never a module variable — Pi loads each extension
 * with an isolated module cache, so module state would be one copy per
 * extension.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import { formatDuration, sanitizeLine, stripControlChars } from "../format.ts";
import { clip, clipMiddle } from "./columns.ts";
import { expandHint, SEPARATORS } from "./glyphs.ts";
import { paint } from "./tokens.ts";

/** The parts of a tool result a renderer reads. */
export interface ToolMessageResult {
	content: ReadonlyArray<{ type: string; text?: string }>;
	isError?: boolean;
}

/** The bold tool name in Pi's tool-title token, the block's only accent. */
export function toolCallTitle(theme: Theme, name: string): string {
	return theme.fg("toolTitle", theme.bold(name));
}

/**
 * One call line: the bold tool name, then the subject in the meta role.
 *
 * The subject is flattened to one line here, because a call line is a label: a
 * stored note, a task, or a path carrying a newline cannot wrap it into the body
 * column, where it would read as a result. Pass the clip the subject deserves —
 * `middle` for a path or a URL whose tail is the identity, `end` for prose.
 *
 * A subject drawn in another role (an argument value in `label`, a suffix in
 * `faint`) stays hand-built at its call site; this is the plain headline.
 */
export function callLine(
	theme: Theme,
	last: unknown,
	name: string,
	subject: string,
	clip: CallClip = "end",
): ToolCallText {
	const text = reuseCallText(last, "", clip);
	text.setText(toolCallTitle(theme, `${name} `) + paint(theme, "meta", sanitizeLine(subject)));
	return text;
}

/**
 * A result resolved to its details, or to the one line a failure shows.
 */
export type DetailsOrLine<Details> = { line: string } | { details: Details };

/**
 * Resolve a result to its details, or to the line to show instead.
 *
 * The failure is one branch whether the call carried no details at all (Pi's
 * `{ details: {}, isError: true }` envelope) or the extension reported its own
 * `details.error`, and it goes through `errorLine`: a multi-line message keeps
 * its lines and `Error:` is prefixed exactly once, which a hand-built
 * `paint(theme, "bad", \`Error: ${sanitizeLine(...)}\`)` does not.
 */
export function detailsOrLine<Details extends object>(
	theme: Theme,
	result: ToolMessageResult,
	expanded: boolean,
	details: Details | undefined,
): DetailsOrLine<Details> {
	if (!details) return { line: rejectionLine(theme, result, expanded) };
	// The one property this reads is the extension's own report field; a details
	// block without it (a plan summary, a check report) simply has no failure.
	if ("error" in details && typeof details.error === "string" && details.error !== "") {
		return { line: errorLine(theme, details.error) };
	}
	return { details };
}

/** How a call line gives up columns when the terminal is narrow. */
export type CallClip = "end" | "middle";

/**
 * A tool call line: the same mutable string as Pi's `Text`, but clipped to the
 * render width instead of wrapped.
 *
 * A call is a label, so it must stay one physical line: a wrap would push the
 * rest of the subject into the body column, where it looks like a result (and,
 * under bytefly's frame, could be railed). `end` preserves the start of prose;
 * `middle` keeps both the head and the tail of a path or URL. It exposes `.text`
 * and `.setText` because bytefly's block resolver rewrites the headline in place.
 *
 * `render` runs on every frame Pi draws, so the clipped lines are memoized on the
 * text and the width, the way Pi's own `Text` does; `setText` and `invalidate`
 * drop them.
 */
export class ToolCallText implements Component {
	text: string;
	readonly clip: CallClip;
	private cachedWidth: number | null = null;
	private cachedText = "";
	private cachedLines: string[] = [];

	constructor(initial = "", clip: CallClip = "end") {
		this.text = initial;
		this.clip = clip;
	}

	setText(text: string): void {
		this.text = text;
		this.cachedWidth = null;
	}

	invalidate(): void {
		this.cachedWidth = null;
	}

	render(width: number): string[] {
		const w = Math.max(1, Math.floor(width));
		if (this.cachedWidth === w && this.cachedText === this.text) return this.cachedLines;
		this.cachedLines = this.text
			.split("\n")
			.map((line) => (this.clip === "middle" ? clipMiddle(line, w) : truncateToWidth(line, w, "…")));
		this.cachedWidth = w;
		this.cachedText = this.text;
		return this.cachedLines;
	}
}

/** Reuse the previous call component when it is one with the same clip mode. */
export function reuseCallText(last: unknown, initial = "", clip: CallClip = "end"): ToolCallText {
	return last instanceof ToolCallText && last.clip === clip ? last : new ToolCallText(initial, clip);
}

/**
 * Sanitized error lines, painted `bad`, with exactly one `Error:` prefix.
 *
 * The raw message is untrusted (a host rejection, a subprocess, a parser), so
 * every line is neutralized before the theme is applied — otherwise the
 * sanitizer would strip the theme's own SGR. A message that already opens with
 * `Error:` is not prefixed twice.
 */
export function errorLine(theme: Theme, message: string): string {
	const lines = messageLines(message);
	if (lines.length === 0) return paint(theme, "bad", "Error: the tool call failed");
	lines[0] = `Error: ${lines[0]?.replace(/^error:\s*/i, "") ?? ""}`;
	return paint(theme, "bad", lines.join("\n"));
}

/**
 * A rejected call: every text block of Pi's `{ details: {}, isError: true }`
 * envelope, sanitized and painted `bad`. Collapsed output keeps the first
 * `maxLines` and points at the expand key; expanded shows all of it.
 */
export function rejectionLine(theme: Theme, result: ToolMessageResult, expanded = false, maxLines = 10): string {
	const text = messageText(result);
	const lines = messageLines(text);
	if (lines.length === 0) return errorLine(theme, "the tool call was rejected");
	const shown = expanded ? lines : lines.slice(0, Math.max(1, maxLines));
	let out = errorLine(theme, shown.join("\n"));
	const hidden = lines.length - shown.length;
	if (hidden > 0) out += `\n${moreHint(theme, hidden)}`;
	return out;
}

/** Every text block of a result, joined; non-text blocks are ignored. */
export function messageText(result: ToolMessageResult): string {
	const parts: string[] = [];
	for (const block of result.content) {
		if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
	}
	return parts.join("\n");
}

/** `… N more lines (ctrl+o to expand)`, the collapsed overflow note. */
export function moreHint(theme: Theme, hidden: number, noun = "lines"): string {
	return `${paint(theme, "faint", `… ${hidden} more ${noun}`)} ${expandHint(theme)}`;
}

/** `… N more` and the expand affordance, for a list whose rows are items. */
export function overflowHint(theme: Theme, hidden: number): string {
	return `${paint(theme, "faint", `… ${hidden} more`)} ${expandHint(theme)}`;
}

/** `… N earlier <label>` and the expand affordance, for a bounded tail. */
export function earlierHint(theme: Theme, hidden: number, label: string): string {
	return `${paint(theme, "faint", `… ${hidden} earlier ${label}`)} ${expandHint(theme)}`;
}

/** The row renderer a {@link TailResult} list uses: the extension's row grammar at a width. */
export type TailRowLine<Row> = (row: Row, width: number, theme: Theme) => string;

/** One group of rows inside a {@link TailResult}, under an optional faint heading. */
export interface TailSection<Row> {
	/** A faint heading above the rows, e.g. `Claims`; omit for the block's primary list. */
	label?: string;
	rows: readonly Row[];
	more: number;
	rowLine: TailRowLine<Row>;
}

/** What a {@link TailResult} draws: the caller's rows plus a hidden count, a headed row list, or a bounded tail. */
export type TailResultInput<Row> =
	| { kind: "list"; rows: readonly Row[]; more: number; rowLine: TailRowLine<Row> }
	| { kind: "sections"; sections: readonly TailSection<Row>[] }
	| { kind: "lines"; lines: readonly string[]; earlier: number; earlierLabel: string };

/**
 * The transcript result block a tool that lists rows or tails output shares.
 *
 * One leading blank line per the block grammar, then either the caller's rows
 * (already ordered and capped) with a "more" note, one headed group of rows per
 * section, or the themed tail with an "earlier" note. The caller owns the row
 * renderer, so the extension's own row grammar — a peer-session tag, a status
 * glyph — stays with its vocabulary.
 */
export class TailResult<Row> implements Component {
	private input: TailResultInput<Row>;
	private theme: Theme;

	constructor(input: TailResultInput<Row>, theme: Theme) {
		this.input = input;
		this.theme = theme;
	}

	/** Update in place so the transcript can reuse this component across renders. */
	setInput(input: TailResultInput<Row>, theme: Theme): void {
		this.input = input;
		this.theme = theme;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const w = Math.max(1, width);
		const lines: string[] = [""];
		const input = this.input;
		if (input.kind === "list") {
			for (const row of input.rows) lines.push(input.rowLine(row, w, this.theme));
			if (input.more > 0) lines.push(clip(`  ${overflowHint(this.theme, input.more)}`, w));
			return lines;
		}
		if (input.kind === "sections") {
			for (const section of input.sections) {
				if (section.label) lines.push(clip(paint(this.theme, "faint", section.label), w));
				for (const row of section.rows) lines.push(section.rowLine(row, w, this.theme));
				if (section.more > 0) lines.push(clip(`  ${overflowHint(this.theme, section.more)}`, w));
			}
			return lines;
		}
		if (input.earlier > 0) lines.push(clip(earlierHint(this.theme, input.earlier, input.earlierLabel), w));
		for (const line of input.lines) lines.push(this.theme.fg("toolOutput", clip(line, w)));
		return lines;
	}
}

/** The render context fields the elapsed timer needs. */
export interface ToolRenderClock {
	/** Pi's per-call render state, opaque here: this module only ever casts it. */
	state: unknown;
	invalidate(): void;
}

interface ElapsedState {
	/** The first render of this call, in ms. */
	startedAt?: number;
	/** The 1s repaint loop, present only while the call is running. */
	elapsedTimer?: ReturnType<typeof setInterval>;
}

/**
 * Keep a running call repainting once a second, and stop when it finishes.
 *
 * Returns the call's start time so a renderer can print `now - startedAt`.
 * The interval is `unref`'d so it never holds the process open; a final render
 * with `running: false` clears it. Tests pass an explicit `now` for determinism.
 */
export function syncElapsedTimer(
	running: boolean,
	context: ToolRenderClock | undefined,
	now = Date.now(),
): number | undefined {
	if (!context?.state) return undefined;
	const state = context.state as ElapsedState;
	if (running && state.startedAt === undefined) state.startedAt = now;
	if (running && !state.elapsedTimer) {
		state.elapsedTimer = setInterval(() => context.invalidate(), 1000);
		(state.elapsedTimer as { unref?: () => void }).unref?.();
	} else if (!running && state.elapsedTimer) {
		clearInterval(state.elapsedTimer);
		state.elapsedTimer = undefined;
	}
	return state.startedAt;
}

/**
 * A faint ` · 1.2s` completion suffix, or `""`.
 *
 * A duration is only worth a column when the wait was perceptible, so the
 * default floor is one second; an unknown duration prints nothing.
 */
export function elapsedSuffix(theme: Theme, durationMs: number | undefined, minMs = 1000): string {
	if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < minMs) return "";
	return paint(theme, "faint", `${SEPARATORS.item}${formatDuration(durationMs)}`);
}

/**
 * Hand Pi a partial result so its result renderer runs while the tool works.
 *
 * Pi only calls `renderResult` once a result exists; without an update, a
 * long-running tool shows nothing to repaint. The empty content is never shown
 * (the renderer's `isPartial` branch draws its own running line) and the host
 * replaces it with the final result.
 */
export function startToolProgress(
	// allow:any Pi's partial-result type is generic over each tool's details, so a shared helper cannot name it.
	onUpdate: ((partial: any) => void) | undefined,
): void {
	onUpdate?.({ content: [], details: undefined });
}

/** Sanitized, non-empty lines of an untrusted message. */
function messageLines(message: string): string[] {
	const lines = stripControlChars(message)
		.split("\n")
		.map((line) => sanitizeLine(line));
	let start = 0;
	let end = lines.length;
	while (start < end && lines[start] === "") start++;
	while (end > start && lines[end - 1] === "") end--;
	return lines.slice(start, end);
}
