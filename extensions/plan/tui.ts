/**
 * Terminal rendering for the plan review screen.
 *
 * `PlanViewComponent` is the scrollable review screen `exit_plan_mode` opens
 * for approval. The plan body is rendered by Pi's own `Markdown` component with
 * the active Markdown theme, so headings, lists, code, links, and quotes match
 * the rest of the application; plan-authored control characters are stripped
 * first so the file cannot drive the terminal. Task checkboxes are recolored
 * and the footer colors the primary actions. Approving leaves plan mode and
 * starts the work, so it asks `y/N` first through the shared `ConfirmState`;
 * the plan stays mounted, and `Esc` backs out of the question before it backs
 * out of the review. It returns the chosen action through `onClose` so the
 * caller can act only after the screen is gone and input focus is free again.
 */

import { basename } from "node:path";
import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import {
	Editor,
	Key,
	Markdown,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	type Component,
	type MarkdownTheme,
	type TUI,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { sanitizeLine } from "../../lib/format.ts";
import {
	editorTheme,
	screenHint,
	viewportRows,
	type ScreenHint,
	type ViewportRowsSource,
} from "../../lib/tui/chrome.ts";
import { isCloseKey } from "../../lib/tui/cursor.ts";
import { ConfirmState } from "../../lib/tui/confirm.ts";
import { gaugeBar } from "../../lib/tui/gauge.ts";
import { GLYPHS } from "../../lib/tui/glyphs.ts";
import { plainRule, titleRule } from "../../lib/tui/rules.ts";
import { emptyState, checkbox } from "../../lib/tui/rows.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { planTitle, type StoredPlan } from "./plans.ts";
import { changedSections, planDisplayText, type SectionDigest } from "./plan-text.ts";

/** What the user chose from the read/review screen. */
export type PlanViewAction = "approve" | "refine" | "keep" | "browser" | "cancel";

/** A plan section's rendered start line, for navigation and the current-section label. */
interface SectionOffset {
	title: string;
	offset: number;
	/** True when this section changed since the previous review. */
	changed?: boolean;
}

/** Rendered body lines for a width, plus the section offsets into them. */
interface BodyCache {
	width: number;
	lines: string[];
	sections: SectionOffset[];
	/** Sections that differ from what the previous review showed. */
	changedCount: number;
}

export interface PlanViewOptions {
	plan: StoredPlan;
	/**
	 * The section digests the previous review of this plan showed, when there was
	 * one. Used only to mark the sections that changed since then.
	 */
	baseline?: SectionDigest[];
	theme: Theme;
	/**
	 * Called once when the screen closes. `refinement` carries the typed text
	 * when the action is `refine` and the inline editor was used.
	 */
	onClose: (action: PlanViewAction, refinement?: string) => void;
	requestRender: () => void;
	viewportRows?: ViewportRowsSource;
	/** TUI handle for the inline refine editor; without it, `r` closes with `refine`. */
	tui?: TUI;
	/** Markdown theme for the body; defaults to Pi's active theme. */
	markdownTheme?: MarkdownTheme;
}

/** Rows the screen shows when the terminal height is unknown. */
const DEFAULT_ROWS = 20;
/** Header, blanks, footer, and closing rule around a non-empty plan. */
const CHROME_ROWS = 5;
/** Narrowest width where Markdown's 2-column padding still fits the body. */
const MIN_PADDED_WIDTH = 6;
/** Left/right body padding, matching the rest of the screen chrome. */
const BODY_PADDING = 2;
/** Segments in the scroll gauge. */
const GAUGE_SEGMENTS = 10;
/** Footer hints shared by the review and the inline editor's primary actions. */
const PRIMARY_HINTS: ScreenHint[] = [
	"Esc keep plan",
	{ text: "a approve", color: "ok" },
	{ text: "r refine", color: "accent" },
	{ text: "w browser", color: "accent" },
	{ text: "x exit plan", color: "warn" },
];
/** Scroll keys appended to the review footer while the plan overflows. */
const SCROLL_HINTS: ScreenHint[] = ["j/k scroll", "space page", "g/G ends"];
/** Section-jump hint, shown when the plan has more than one heading section. */
const SECTION_HINTS: ScreenHint[] = ["n/p section"];

/** A task checkbox in a list marker: `- [x] `, `1. [ ] `. */
const TASK_MARKER = /^([-*+]|\d+[.)])(\s+)(\[([ xX])\])(\s*)$/;

/**
 * Wrap the Markdown theme so task checkboxes read at a glance with the shared
 * `◼`/`◻` vocabulary, the same box the bytefly screen and the question dialog
 * draw. The box is one column wide instead of the bracket's three, so the two
 * freed columns are kept as padding: pi-tui derives a continuation line's indent
 * from the original marker's width, and shortening the marker without padding
 * hangs every wrapped task line two columns too far right, where the width
 * truncation clips its tail.
 */
function planMarkdownTheme(theme: Theme, base: MarkdownTheme): MarkdownTheme {
	return {
		...base,
		listBullet: (text) => {
			const match = TASK_MARKER.exec(text);
			if (!match) return base.listBullet(text);
			const [, bullet, gap, , mark, trail] = match;
			const themed = `${base.listBullet(`${bullet}${gap}`)}${checkbox(theme, mark.toLowerCase() === "x")}`;
			const pad = Math.max(0, visibleWidth(text) - visibleWidth(themed) - visibleWidth(trail));
			return `${themed}${" ".repeat(pad)}${trail}`;
		},
	};
}

/** Scroll position below the body: a gauge, the percent, and the visible range. */
function scrollRow(
	theme: Theme,
	width: number,
	offset: number,
	end: number,
	total: number,
	section?: SectionOffset,
): string {
	const maxOffset = Math.max(0, total - (end - offset));
	const percent = maxOffset > 0 ? Math.round((offset / maxOffset) * 100) : 100;
	const bar = gaugeBar(theme, { percent, blocks: GAUGE_SEGMENTS, role: "accent", emptyRole: "faint" });
	const head = `${bar} ${paint(theme, "accent", `${percent}%`)}`;
	const range = paint(theme, "faint", `lines ${offset + 1}–${end} of ${total}`);
	const name = section?.title ? paint(theme, "meta", `${GLYPHS.plan} ${section.title}`) : "";
	const label = name && section?.changed ? name + paint(theme, "accent", " · changed") : name;
	// Keep the gauge and percent; drop the range first, then the section label, on a
	// narrow terminal. The marker-less `name` candidate keeps the section visible
	// when the label with its `· changed` suffix no longer fits.
	const candidates = [
		`  ${head}  ${[label, range].filter(Boolean).join("  ")}`,
		`  ${head}  ${range}`,
		label ? `  ${head}  ${label}` : "",
		name ? `  ${head}  ${name}` : "",
		`  ${head}`,
	];
	for (const candidate of candidates) {
		if (candidate !== "" && visibleWidth(candidate) <= width) return candidate;
	}
	return truncateToWidth(`  ${head}`, width);
}

/** Scrollable plan review screen opened by `exit_plan_mode`. */
export class PlanViewComponent implements Component {
	private offset = 0;
	private visible = DEFAULT_ROWS;
	private maxOffset = 0;
	/** Rendered body lines and section offsets, cached per width. */
	private cache: BodyCache | null = null;
	/** True while the inline refine editor owns the keyboard. */
	private editing = false;
	/** The y/N approval question, shared with the other destructive screens. */
	private readonly confirm = new ConfirmState();
	/** The inline refine editor, built lazily once a TUI handle is available. */
	private editor: Editor | null = null;

	constructor(private readonly options: PlanViewOptions) {}

	private get theme(): Theme {
		return this.options.theme;
	}

	/**
	 * Styled, width-safe body lines for the given outer width, plus where each
	 * heading section starts. Sections are rendered independently because Pi's
	 * `Markdown` exposes no source-line map: rendering a section alone is the only
	 * reliable way to know its first body line.
	 */
	private build(width: number): BodyCache {
		if (this.cache?.width === width) return this.cache;
		const padding = width >= MIN_PADDED_WIDTH ? BODY_PADDING : 0;
		const base = this.options.markdownTheme ?? getMarkdownTheme();
		const theme = planMarkdownTheme(this.theme, base);
		const current = planDisplayText(this.options.plan.content);
		const marks = changedSections(this.options.baseline, current);
		const lines: string[] = [];
		const sections: SectionOffset[] = [];
		marks.forEach(({ section: chunk, changed }, index) => {
			// Markdown pads every line to the full width for backgrounds; this screen
			// draws no background, so the padding is dropped.
			const rendered = new Markdown(chunk.text, padding, 0, theme)
				.render(width)
				.map((line) => truncateToWidth(line.trimEnd(), width));
			sections.push({
				title: chunk.title,
				offset: lines.length,
				...(changed ? { changed: true } : {}),
			});
			lines.push(...rendered);
			// Sections render independently, so restore the blank line a heading-only
			// chunk omits before the next section.
			if (index < marks.length - 1 && lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
		});
		this.cache = { width, lines, sections, changedCount: marks.filter((mark) => mark.changed).length };
		return this.cache;
	}

	/** The section whose heading is at or above the viewport top. */
	private currentSection(sections: SectionOffset[]): SectionOffset | undefined {
		let current: SectionOffset | undefined;
		for (const section of sections) {
			if (section.offset > this.offset) break;
			current = section;
		}
		return current;
	}

	/** Scroll to the next (`1`) or previous (`-1`) section heading. */
	private jumpSection(direction: 1 | -1): void {
		const sections = this.cache?.sections ?? [];
		if (sections.length < 2) return;
		if (direction === 1) {
			const next = sections.find((section) => section.offset > this.offset);
			this.scrollTo(next ? next.offset : this.maxOffset);
			return;
		}
		let previous: SectionOffset | undefined;
		for (const section of sections) {
			if (section.offset >= this.offset) break;
			previous = section;
		}
		this.scrollTo(previous ? previous.offset : 0);
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
			if (isCloseKey(data)) {
				this.cancelRefine();
				return;
			}
			this.editor?.handleInput(data);
			this.options.requestRender();
			return;
		}
		// A pending question owns the keyboard, so a scroll key cannot slip past it
		// and `Esc` backs out of the question rather than the review.
		if (this.confirm.pending) {
			if (this.confirm.resolve(data) !== undefined) this.options.requestRender();
			return;
		}
		if (isCloseKey(data)) {
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
		else if (data === "n") this.jumpSection(1);
		else if (data === "p") this.jumpSection(-1);
		else if (data === "a") {
			this.confirm.ask("Approve and run the plan? y/N", () => this.options.onClose("approve"));
			this.options.requestRender();
		} else if (data === "r") this.startRefine();
		else if (data === "w") this.options.onClose("browser");
		else if (data === "x") this.options.onClose("cancel");
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
		const title = sanitizeLine(planTitle(basename(plan.path)));

		const previousWidth = this.cache?.width;
		const built = plan.content.trim() ? this.build(w) : { width: w, lines: [], sections: [], changedCount: 0 };
		const body = built.lines;
		const sections = built.sections;
		const changedCount = built.changedCount;
		const editorLines = this.editing ? (this.editor?.render(Math.max(1, w - 2)) ?? []) : [];
		const editorRows = editorLines.length > 0 ? editorLines.length + 2 : 0;
		const changedRows = changedCount > 0 ? 1 : 0;
		const chrome = CHROME_ROWS + changedRows + (body.length === 0 ? 1 : 0) + editorRows;
		const visible = viewportRows(this.options.viewportRows, { chrome, fallback: DEFAULT_ROWS });
		this.visible = visible;
		const maxOffset = Math.max(0, body.length - visible);
		// Markdown has no source-line map, so a resize keeps the offset's fraction
		// of the plan: the reader stays at roughly the same place.
		if (previousWidth !== undefined && previousWidth !== w && this.maxOffset > 0 && maxOffset > 0) {
			this.offset = Math.round((this.offset / this.maxOffset) * maxOffset);
		}
		this.maxOffset = maxOffset;
		this.offset = Math.min(Math.max(0, this.offset), maxOffset);
		const sectionLabel = this.currentSection(sections);

		const lines: string[] = [titleRule(theme, w, truncateToWidth(`Plan Review · ${title}`, Math.max(1, w - 6)))];
		lines.push("");
		if (changedCount > 0) {
			const noun = changedCount === 1 ? "section" : "sections";
			lines.push(
				truncateToWidth(`  ${paint(theme, "accent", `${changedCount} ${noun} changed since your last review`)}`, w),
			);
		}

		const end = Math.min(body.length, this.offset + visible);
		for (let i = this.offset; i < end; i++) lines.push(body[i]);
		if (body.length === 0) lines.push(...emptyState(theme, w, { label: "This plan is empty." }));

		if (this.editing) {
			// Keep the scroll position visible while editing: the body above is still
			// clipped, so the reader needs to know where they are.
			if (this.maxOffset > 0) lines.push(scrollRow(theme, w, this.offset, end, body.length, sectionLabel));
			else lines.push("");
			lines.push(truncateToWidth(`  ${paint(theme, "meta", "Refine the plan:")}`, w));
			for (const line of editorLines) lines.push(truncateToWidth(`  ${line}`, w));
			lines.push("");
			lines.push(screenHint(theme, w, ["Esc back to plan", { text: "Enter submit", color: "ok" }]));
		} else {
			if (this.maxOffset > 0) lines.push(scrollRow(theme, w, this.offset, end, body.length, sectionLabel));
			else lines.push("");
			const pending = this.confirm.pending;
			const sectionHints = sections.length > 1 ? SECTION_HINTS : [];
			const hints: ScreenHint[] =
				this.maxOffset > 0 ? [...PRIMARY_HINTS, ...SCROLL_HINTS, ...sectionHints] : PRIMARY_HINTS;
			lines.push(
				pending ? truncateToWidth(`  ${paint(theme, "warn", pending.prompt)}`, w) : screenHint(theme, w, hints),
			);
		}
		lines.push(plainRule(theme, w));
		return lines;
	}
}
