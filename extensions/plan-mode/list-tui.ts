/**
 * Terminal rendering for the plan browser.
 *
 * `PlanListComponent` is the selectable screen `/plans` opens in the TUI. It
 * lists the plans directory newest-first and resolves the chosen action through
 * `onClose`, so the command runs a confirm dialog (for delete/use) only after the
 * screen is gone and input focus is free again. Rows are width-safe; the selected
 * plan is highlighted and the rest are dim.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	Key,
	matchesKey,
	truncateToWidth,
	type Component,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { screenHeader, screenHint, viewportRows, type ViewportRowsSource } from "../_shared/tui.ts";
import type { PlanSummary } from "./plans.ts";

/** What the user chose from the list. */
export type PlanListAction =
	| { action: "view"; plan: PlanSummary }
	| { action: "delete"; plan: PlanSummary }
	| { action: "use"; plan: PlanSummary };

export interface PlanListOptions {
	plans: PlanSummary[];
	theme: Theme;
	/** Absolute path of the plan written this session, marked with `●`. */
	activePlanPath?: string;
	/** Called once when the screen closes, with the chosen action or undefined. */
	onClose: (action?: PlanListAction) => void;
	requestRender: () => void;
	viewportRows?: ViewportRowsSource;
}

/** Rows the screen shows when the terminal height is unknown. */
const SCREEN_DEFAULT_PLANS = 12;
/** Header, summary, blanks, and footer rows around the list (excluding the optional range row). */
const SCREEN_CHROME_ROWS = 7;

/** Relative age of a plan's mtime: `just now`, `5m ago`, `3h ago`, `2d ago`, or a date. */
export function formatPlanAge(modified: number, now = Date.now()): string {
	const diff = now - modified;
	if (!Number.isFinite(diff) || diff < 60_000) return "just now";
	const minutes = Math.floor(diff / 60_000);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d ago`;
	const date = new Date(modified);
	const pad = (value: number): string => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export interface PlanRowOptions {
	/** Mark the plan written in the current session with `●` instead of `◦`. */
	active?: boolean;
	/** Clock used for the relative age; defaults to `Date.now()`. */
	now?: number;
}

/** `◦ title · N steps · 2h ago · relative/path` for one row, clipped to `width`. */
export function formatPlanRow(plan: PlanSummary, width: number, options: PlanRowOptions = {}): string {
	const steps = `${plan.steps} step${plan.steps === 1 ? "" : "s"}`;
	const marker = options.active ? "●" : "◦";
	const age = formatPlanAge(plan.modified, options.now);
	return truncateToWidth(`${marker} ${plan.title} · ${steps} · ${age} · ${plan.relativePath}`, Math.max(1, width));
}

/** Selectable, scrollable plan list opened by `/plans`. */
export class PlanListComponent implements Component {
	private selected = 0;
	private scrollTop = 0;
	private visible = SCREEN_DEFAULT_PLANS;

	constructor(private readonly options: PlanListOptions) {}

	private get plans(): PlanSummary[] {
		return this.options.plans;
	}

	private get theme(): Theme {
		return this.options.theme;
	}

	/** Move the cursor, clamping at both ends and keeping it on screen. */
	private setSelected(next: number): void {
		if (this.plans.length === 0) return;
		const clamped = Math.min(Math.max(0, next), this.plans.length - 1);
		if (clamped === this.selected) return;
		this.selected = clamped;
		if (this.selected < this.scrollTop) this.scrollTop = this.selected;
		else if (this.selected >= this.scrollTop + this.visible) this.scrollTop = this.selected - this.visible + 1;
		this.options.requestRender();
	}

	private selectedPlan(): PlanSummary | undefined {
		return this.plans[this.selected];
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.options.onClose(undefined);
			return;
		}
		if (matchesKey(data, Key.up) || data === "k") this.setSelected(this.selected - 1);
		else if (matchesKey(data, Key.down) || data === "j") this.setSelected(this.selected + 1);
		else if (matchesKey(data, Key.pageUp)) this.setSelected(this.selected - this.visible);
		else if (matchesKey(data, Key.pageDown)) this.setSelected(this.selected + this.visible);
		else if (matchesKey(data, Key.home)) this.setSelected(0);
		else if (matchesKey(data, Key.end)) this.setSelected(this.plans.length - 1);
		else if (matchesKey(data, Key.enter)) {
			const plan = this.selectedPlan();
			if (plan) this.options.onClose({ action: "view", plan });
		} else if (data === "d") {
			const plan = this.selectedPlan();
			if (plan) this.options.onClose({ action: "delete", plan });
		} else if (data === "u") {
			const plan = this.selectedPlan();
			if (plan) this.options.onClose({ action: "use", plan });
		}
	}

	/** Wheel scrolling in fullscreen moves the cursor; regular mode leaves the wheel to the terminal. */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "wheel" || !event.wheelDelta) return undefined;
		this.setSelected(this.selected + event.wheelDelta);
		return { handled: true };
	}

	invalidate(): void {}

	render(width: number): string[] {
		const theme = this.theme;
		const w = Math.max(1, width);
		const lines: string[] = [screenHeader(theme, w, "Plans")];

		if (this.plans.length === 0) {
			lines.push(
				truncateToWidth(`  ${theme.fg("dim", "No plans yet. Write one with write_plan while planning.")}`, w),
			);
			lines.push("");
			lines.push(screenHint(theme, w, ["Esc close"]));
			lines.push("");
			return lines;
		}

		const count = `${this.plans.length} plan${this.plans.length === 1 ? "" : "s"}`;
		lines.push(truncateToWidth(`  ${theme.fg("muted", `${count} · newest first`)}`, w));
		lines.push("");

		let visible = viewportRows(this.options.viewportRows, {
			chrome: SCREEN_CHROME_ROWS,
			fallback: SCREEN_DEFAULT_PLANS,
		});
		// Reserve the range row only when the list is longer than the viewport.
		if (this.plans.length > visible) {
			visible = viewportRows(this.options.viewportRows, {
				chrome: SCREEN_CHROME_ROWS + 1,
				fallback: SCREEN_DEFAULT_PLANS,
			});
		}
		this.visible = visible;
		this.selected = Math.min(this.selected, this.plans.length - 1);
		if (this.selected < this.scrollTop) this.scrollTop = this.selected;
		else if (this.selected >= this.scrollTop + visible) this.scrollTop = this.selected - visible + 1;
		this.scrollTop = Math.min(this.scrollTop, Math.max(0, this.plans.length - visible));

		const end = Math.min(this.plans.length, this.scrollTop + visible);
		const now = Date.now();
		for (let i = this.scrollTop; i < end; i++) {
			const selected = i === this.selected;
			const active = this.options.activePlanPath !== undefined && this.plans[i].path === this.options.activePlanPath;
			const row = formatPlanRow(this.plans[i], Math.max(1, w - 2), { active, now });
			const marker = selected ? theme.fg("accent", "❯ ") : "  ";
			const body = selected ? theme.fg("accent", row) : theme.fg("dim", row);
			lines.push(truncateToWidth(marker + body, w));
		}
		if (this.scrollTop > 0 || end < this.plans.length) {
			lines.push(
				truncateToWidth(theme.fg("dim", `  showing ${this.scrollTop + 1}–${end} of ${this.plans.length}`), w),
			);
		}
		lines.push("");
		lines.push(screenHint(theme, w, ["Enter view", "d delete", "u use", "Esc close"]));
		lines.push("");
		return lines;
	}
}
