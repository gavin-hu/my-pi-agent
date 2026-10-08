/**
 * Terminal rendering for the plan review screen.
 *
 * `PlanViewComponent` is the scrollable read/review screen. `exit_plan_mode`
 * opens it for approval (`mode: "review"`), and the `/plans` browser opens it
 * read-only (`mode: "browse"`). It sanitizes the plan file for terminal display
 * and returns the chosen action through `onClose` so the caller can act only
 * after the screen is gone and input focus is free again.
 */

import { basename } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	Editor,
	type EditorTheme,
	Key,
	matchesKey,
	truncateToWidth,
	wrapTextWithAnsi,
	type Component,
	type TUI,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { screenHeader, screenHint, viewportRows, type ViewportRowsSource } from "../../lib/tui.ts";
import { planTitle, type StoredPlan } from "./plans.ts";

/** What the user chose from the read/review screen. */
export type PlanViewAction = "approve" | "refine" | "keep";

export interface PlanViewOptions {
	plan: StoredPlan;
	theme: Theme;
	/**
	 * Called once when the screen closes. `refinement` carries the typed text
	 * when the action is `refine` and the inline editor was used.
	 */
	onClose: (action: PlanViewAction, refinement?: string) => void;
	requestRender: () => void;
	viewportRows?: ViewportRowsSource;
	/** `browse` opens a saved plan read-only (no approve/refine); defaults to `review`. */
	mode?: "review" | "browse";
	/** TUI handle for the inline refine editor; without it, `r` closes with `refine`. */
	tui?: TUI;
}

/** Rows the screen shows when the terminal height is unknown. */
const DEFAULT_ROWS = 20;
/** Header, blanks, and footer rows around a non-empty plan. */
const CHROME_ROWS = 5;

/** Spaces a tab expands to; the terminal's own tab stops are not width-modelled. */
const TAB_WIDTH = 4;

/** Replace control characters (including ESC and the C1 block) so model text cannot drive the terminal. */
function sanitize(text: string): string {
	return text.replace(/\t/g, " ".repeat(TAB_WIDTH)).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, " ");
}

/** Light markdown styling for one source line. */
function styleLine(theme: Theme, raw: string): string {
	const line = sanitize(raw).trimEnd();
	if (/^\s{0,3}#{1,6}(\s|$)/.test(line)) return theme.fg("accent", theme.bold(line));
	if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) return theme.fg("dim", line);
	const bullet = line.match(/^(\s*)([-*+]|\d+[.)])(\s+.*)$/);
	if (bullet) return `${bullet[1]}${theme.fg("accent", bullet[2])}${bullet[3]}`;
	return line;
}

/** One display line: the styled text plus the source line it wrapped from. */
interface BodyLine {
	text: string;
	source: number;
}

/** Human title for the header: the file name without its extension or stamp. */
function displayTitle(fileName: string): string {
	return planTitle(fileName);
}

/** Minimal editor theme for the inline refine input. */
function editorTheme(theme: Theme): EditorTheme {
	return {
		borderColor: (text) => theme.fg("borderMuted", text),
		selectList: {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		},
	};
}

/** Scrollable plan read/review screen shared by `exit_plan_mode` and `/plans`. */
export class PlanViewComponent implements Component {
	private offset = 0;
	private visible = DEFAULT_ROWS;
	private maxOffset = 0;
	/** Wrapped lines are expensive to build, so they are cached per width. */
	private cache: { width: number; lines: BodyLine[] } | null = null;
	/** Source line (and wrap offset) the view starts at, so a resize keeps its place. */
	private anchor: { source: number; within: number } | null = null;
	/** True while the inline refine editor owns the keyboard. */
	private editing = false;
	/** The inline refine editor, built lazily once a TUI handle is available. */
	private editor: Editor | null = null;

	constructor(private readonly options: PlanViewOptions) {}

	private get theme(): Theme {
		return this.options.theme;
	}

	/** True when the screen is a read-only browser, not an approval prompt. */
	private browse(): boolean {
		return this.options.mode === "browse";
	}

	/** Styled, wrapped body lines for the given outer width. */
	private body(width: number): BodyLine[] {
		if (this.cache?.width === width) return this.cache.lines;
		const inner = Math.max(1, width - 2);
		const out: BodyLine[] = [];
		const source = this.options.plan.content.split("\n");
		for (let index = 0; index < source.length; index++) {
			const raw = source[index];
			for (const line of wrapTextWithAnsi(styleLine(this.theme, raw), inner)) {
				out.push({ text: `  ${line}`, source: index });
			}
		}
		this.cache = { width, lines: out };
		return out;
	}

	/** Re-place the view after a width change so the same source line stays on top. */
	private reanchor(body: BodyLine[]): void {
		if (!this.anchor) return;
		const { source, within } = this.anchor;
		const start = body.findIndex((line) => line.source === source);
		if (start < 0) return;
		let count = 0;
		while (start + count < body.length && body[start + count].source === source) count++;
		this.offset = Math.min(start + Math.min(within, count - 1), this.maxOffset);
	}

	/** Remember which source line and wrap position the view currently starts at. */
	private updateAnchor(body: BodyLine[]): void {
		const top = body[this.offset];
		if (!top) {
			this.anchor = null;
			return;
		}
		let within = 0;
		for (let i = this.offset - 1; i >= 0 && body[i].source === top.source; i--) within++;
		this.anchor = { source: top.source, within };
	}

	/** Move the view to an absolute body line, clamped to the plan. */
	private scrollTo(offset: number): void {
		const next = Math.min(Math.max(0, offset), this.maxOffset);
		if (next === this.offset) return;
		this.offset = next;
		this.options.requestRender();
	}

	private scroll(delta: number): void {
		this.scrollTo(this.offset + delta);
	}

	/** Rows a half-page key moves; at least one. */
	private halfPage(): number {
		return Math.max(1, Math.floor(this.visible / 2));
	}

	/** Lazily build the inline refine editor; needs a TUI handle. */
	private ensureEditor(): Editor | null {
		if (!this.options.tui) return null;
		if (!this.editor) {
			const editor = new Editor(this.options.tui, editorTheme(this.theme));
			editor.onSubmit = (value) => this.submitRefinement(value);
			this.editor = editor;
		}
		return this.editor;
	}

	/** Open the inline refine input; without a TUI, close with `refine` as before. */
	private startRefine(): void {
		const editor = this.ensureEditor();
		if (!editor) {
			this.options.onClose("refine");
			return;
		}
		editor.setText("");
		editor.focused = true;
		this.editing = true;
		this.options.requestRender();
	}

	/** Leave the inline refine input without submitting; the review stays open. */
	private cancelRefine(): void {
		this.editing = false;
		if (this.editor) this.editor.focused = false;
		this.options.requestRender();
	}

	/** Submit the typed refinement; an empty buffer stays in the editor. */
	private submitRefinement(value: string): void {
		const text = value.trim();
		if (!text) return;
		this.editing = false;
		if (this.editor) this.editor.focused = false;
		this.options.onClose("refine", text);
	}

	handleInput(data: string): void {
		if (this.editing) {
			if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
				this.cancelRefine();
				return;
			}
			this.editor?.handleInput(data);
			this.options.requestRender();
			return;
		}
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.options.onClose("keep");
			return;
		}
		// Page keys keep one line of context instead of replacing the whole screen.
		const page = Math.max(1, this.visible - 1);
		if (matchesKey(data, Key.up) || data === "k") this.scroll(-1);
		else if (matchesKey(data, Key.down) || data === "j") this.scroll(1);
		else if (matchesKey(data, Key.pageUp) || data === "b") this.scroll(-page);
		else if (matchesKey(data, Key.pageDown) || data === " ") this.scroll(page);
		else if (matchesKey(data, Key.ctrl("u")) || data === "u") this.scroll(-this.halfPage());
		else if (matchesKey(data, Key.ctrl("d")) || data === "d") this.scroll(this.halfPage());
		else if (matchesKey(data, Key.home) || data === "g") this.scrollTo(0);
		else if (matchesKey(data, Key.end) || data === "G") this.scrollTo(this.maxOffset);
		else if (data === "a" && !this.browse()) this.options.onClose("approve");
		else if (data === "r" && !this.browse()) this.startRefine();
	}

	/** Wheel scrolling in fullscreen; regular mode leaves the wheel to the terminal. */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "wheel" || !event.wheelDelta) return undefined;
		this.scroll(event.wheelDelta);
		return { handled: true };
	}

	invalidate(): void {
		this.cache = null;
		this.editor?.invalidate();
	}

	render(width: number): string[] {
		const theme = this.theme;
		const w = Math.max(1, width);
		const plan = this.options.plan;
		const title = displayTitle(basename(plan.path));

		const cachedWidth = this.cache?.width;
		const body = plan.content.trim() ? this.body(w) : [];
		const editorLines = this.editing ? (this.editor?.render(Math.max(1, w - 2)) ?? []) : [];
		const editorRows = editorLines.length > 0 ? editorLines.length + 2 : 0;
		const chrome = CHROME_ROWS + (body.length === 0 ? 1 : 0) + editorRows;
		const visible = viewportRows(this.options.viewportRows, { chrome, fallback: DEFAULT_ROWS });
		this.visible = visible;
		this.maxOffset = Math.max(0, body.length - visible);
		if (cachedWidth !== undefined && cachedWidth !== w) this.reanchor(body);
		this.offset = Math.min(Math.max(0, this.offset), this.maxOffset);
		this.updateAnchor(body);

		const lines: string[] = [
			screenHeader(
				theme,
				w,
				truncateToWidth(`${this.browse() ? "Plan" : "Plan Review"} · ${title}`, Math.max(1, w - 6)),
			),
			"",
		];

		const end = Math.min(body.length, this.offset + visible);
		for (let i = this.offset; i < end; i++) lines.push(truncateToWidth(body[i].text, w));
		if (body.length === 0) lines.push(truncateToWidth(`  ${theme.fg("dim", "This plan is empty.")}`, w));

		if (this.editing) {
			lines.push("");
			lines.push(truncateToWidth(`  ${theme.fg("muted", "Refine the plan:")}`, w));
			for (const line of editorLines) lines.push(truncateToWidth(`  ${line}`, w));
		}

		lines.push("");
		if (this.editing) {
			lines.push(screenHint(theme, w, ["Enter submit", "Esc back to plan"]));
		} else {
			const scrollable = this.maxOffset > 0;
			const percent = this.maxOffset === 0 ? 100 : Math.round((this.offset / this.maxOffset) * 100);
			const hints = scrollable
				? [
						...(this.browse() ? ["Esc close"] : ["a approve", "r refine", "Esc keep"]),
						"↑/↓ or k/j scroll",
						`lines ${this.offset + 1}–${end} of ${body.length} (${percent}%)`,
						"space/b page",
						"g/G ends",
					]
				: this.browse()
					? ["Esc close"]
					: ["a approve", "r refine", "Esc keep planning"];
			lines.push(screenHint(theme, w, hints));
		}
		lines.push("");
		return lines;
	}
}
