/**
 * Terminal rendering for the plan review screen.
 *
 * `PlanReviewComponent` is the scrollable screen `exit_plan_mode` opens in the
 * TUI. It reads the plan file the user is approving, sanitizes it for terminal
 * display, and returns the chosen action through `onClose` so the tool can act
 * only after the screen is gone and input focus is free again.
 */

import { basename } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type Component,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { screenHeader, viewportRows, type ViewportRowsSource } from "../_shared/tui.ts";
import { planTitle, type StoredPlan } from "./plans.ts";
import { extractPlanSteps } from "./steps.ts";

/** What the user chose from the review screen. */
export type PlanReviewAction = "approve" | "refine" | "keep";

export interface PlanReviewOptions {
	plan: StoredPlan;
	theme: Theme;
	/** Called once when the screen closes. */
	onClose: (action: PlanReviewAction) => void;
	requestRender: () => void;
	viewportRows?: ViewportRowsSource;
	/** `browse` opens a saved plan read-only (no approve/refine); defaults to `review`. */
	mode?: "review" | "browse";
}

/** Rows the screen shows when the terminal height is unknown. */
const DEFAULT_ROWS = 20;
/** Header, subtitle, blanks, and footer rows around a non-empty plan. */
const CHROME_ROWS = 6;

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
	/** Nearest heading at or above this line, for the sticky section title. */
	heading: string | null;
	/** Source line of that heading, or -1 when there is none. */
	headingSource: number;
}

/** Heading text without the leading `#` markers, or null when the line is not a heading. */
function headingText(raw: string): string | null {
	const text = sanitize(raw)
		.match(/^\s{0,3}#{1,6}(?:\s+(.*))?$/)?.[1]
		?.trim();
	return text ? text : null;
}

/** Human title for the header: the file name without its extension or stamp. */
function displayTitle(fileName: string): string {
	return planTitle(fileName);
}

/** Selectable, scrollable plan review opened by `exit_plan_mode`. */
export class PlanReviewComponent implements Component {
	private offset = 0;
	private visible = DEFAULT_ROWS;
	private maxOffset = 0;
	/** Wrapped lines are expensive to build, so they are cached per width. */
	private cache: { width: number; lines: BodyLine[] } | null = null;
	/** Plan steps are content-derived and fixed per component, so count them once. */
	private stepCount: number | undefined;
	/** Source line (and wrap offset) the view starts at, so a resize keeps its place. */
	private anchor: { source: number; within: number } | null = null;

	constructor(private readonly options: PlanReviewOptions) {}

	private get theme(): Theme {
		return this.options.theme;
	}

	/** True when the screen is a read-only browser, not an approval prompt. */
	private browse(): boolean {
		return this.options.mode === "browse";
	}

	/** Number of plan steps, counted once. */
	private planSteps(): number {
		return (this.stepCount ??= extractPlanSteps(this.options.plan.content).length);
	}

	/** Styled, wrapped body lines for the given outer width. */
	private body(width: number): BodyLine[] {
		if (this.cache?.width === width) return this.cache.lines;
		const inner = Math.max(1, width - 2);
		const out: BodyLine[] = [];
		const source = this.options.plan.content.split("\n");
		let heading: string | null = null;
		let headingSource = -1;
		for (let index = 0; index < source.length; index++) {
			const raw = source[index];
			const display = headingText(raw);
			if (display) {
				heading = display;
				headingSource = index;
			}
			for (const line of wrapTextWithAnsi(styleLine(this.theme, raw), inner)) {
				out.push({ text: `  ${line}`, source: index, heading, headingSource });
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

	handleInput(data: string): void {
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
		else if (data === "r" && !this.browse()) this.options.onClose("refine");
	}

	/** Wheel scrolling in fullscreen; regular mode leaves the wheel to the terminal. */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "wheel" || !event.wheelDelta) return undefined;
		this.scroll(event.wheelDelta);
		return { handled: true };
	}

	invalidate(): void {
		this.cache = null;
	}

	render(width: number): string[] {
		const theme = this.theme;
		const w = Math.max(1, width);
		const plan = this.options.plan;
		const steps = this.planSteps();
		const title = displayTitle(basename(plan.path));

		const cachedWidth = this.cache?.width;
		const body = plan.content.trim() ? this.body(w) : [];
		const chrome = CHROME_ROWS + (body.length === 0 ? 1 : 0);
		const visible = viewportRows(this.options.viewportRows, { chrome, fallback: DEFAULT_ROWS });
		this.visible = visible;
		this.maxOffset = Math.max(0, body.length - visible);
		if (cachedWidth !== undefined && cachedWidth !== w) this.reanchor(body);
		this.offset = Math.min(Math.max(0, this.offset), this.maxOffset);
		this.updateAnchor(body);

		const top = body[this.offset];
		const sticky = this.maxOffset > 0 && top && top.heading && top.headingSource < top.source ? top.heading : null;
		// Section and step count come first so a long path cannot push them off screen.
		const stepLabel = `${steps} step${steps === 1 ? "" : "s"}`;
		const section = sticky ? `${theme.fg("accent", `§ ${sticky}`)} · ` : "";
		const subtitle = `${section}${theme.fg("muted", [stepLabel, plan.relativePath].join(" · "))}`;
		const lines: string[] = [
			screenHeader(theme, w, truncateToWidth(`${this.browse() ? "Plan" : "Plan Review"} · ${title}`, Math.max(1, w - 6))),
			truncateToWidth(`  ${subtitle}`, w),
			"",
		];

		const end = Math.min(body.length, this.offset + visible);
		for (let i = this.offset; i < end; i++) lines.push(truncateToWidth(body[i].text, w));
		if (body.length === 0) lines.push(truncateToWidth(`  ${theme.fg("dim", "(empty plan)")}`, w));

		lines.push("");
		const scrollable = this.maxOffset > 0;
		const percent = this.maxOffset === 0 ? 100 : Math.round((this.offset / this.maxOffset) * 100);
		const hints = scrollable
			? [
					...(this.browse() ? ["Esc close"] : ["a approve", "r refine", "Esc keep"]),
					"↑↓/j/k scroll",
					`lines ${this.offset + 1}–${end} of ${body.length} (${percent}%)`,
					"space/b page",
					"g/G ends",
				]
			: this.browse()
				? ["Esc close"]
				: ["a approve", "r refine", "Esc keep planning"];
		// Add hints until the row would overflow, so a narrow terminal drops whole
		// keys instead of truncating one in half.
		const footer: string[] = [];
		for (const hint of hints) {
			const candidate = [...footer, hint].join(" · ");
			if (footer.length > 0 && visibleWidth(`  ${candidate}`) > w) break;
			footer.push(hint);
		}
		lines.push(truncateToWidth(`  ${theme.fg("dim", footer.join(" · "))}`, w));
		lines.push("");
		return lines;
	}
}
