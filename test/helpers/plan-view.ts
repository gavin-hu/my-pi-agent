/**
 * The plan review component, driven at a fixed width and row count.
 *
 * Both review suites build on it — the body, navigation, and actions one, and the
 * footer-hint one — so a case states its fixture and its assertion instead of the
 * component's constructor options. No test needs a terminal: widths and row counts
 * are arguments, and assertions are about fields, bounds, ordering, and glyphs,
 * never literal column padding.
 */

import type { MarkdownTheme } from "@earendil-works/pi-tui";
import { sectionDigests } from "../../extensions/plan/plan-text.ts";
import type { StoredPlan } from "../../extensions/plan/plans.ts";
import { PlanViewComponent, type PlanViewAction, type PlanViewOptions } from "../../extensions/plan/tui.ts";
import { fakeMarkdownTheme, fakeTheme } from "./fakes.ts";

/** The demo plan the fixtures render under. */
const DEMO_PATH = "~/.pi/agent/plans/a1f9c02/2026-10-08-1530-demo.md";

/** A theme the review screen accepts. */
export type ReviewTheme = PlanViewOptions["theme"];

/** A TUI handle stub, for the inline refine editor. */
export const REVIEW_TUI = {
	requestRender: () => {},
	terminal: { rows: 24, columns: 80 },
} as unknown as NonNullable<PlanViewOptions["tui"]>;

/** A stored plan whose byte count is its content's, so no case needs a file. */
export function planFixture(content: string, path = DEMO_PATH): StoredPlan {
	return { path, relativePath: DEMO_PATH, content, bytes: content.length };
}

/** The rows the component draws at `width`. */
export function renderReview(component: PlanViewComponent, width: number): string[] {
	return component.render(width);
}

export interface PlanReviewOptions {
	rows?: number;
	tui?: unknown;
	theme?: ReviewTheme;
	markdownTheme?: MarkdownTheme;
	path?: string;
	/** Content the previous review showed, for the changed markers. */
	baseline?: string;
}

/** A review over `content`, recording the actions and refinements it closes with. */
export function planReview(
	content = "# Plan\n1. Read the parser\n2. Add a tokenizer",
	options: PlanReviewOptions = {},
) {
	const actions: PlanViewAction[] = [];
	const refinements: Array<string | undefined> = [];
	let renders = 0;
	const theme = options.theme ?? fakeTheme;
	const component = new PlanViewComponent({
		plan: planFixture(content, options.path),
		baseline: options.baseline === undefined ? undefined : sectionDigests(options.baseline),
		theme,
		markdownTheme: options.markdownTheme ?? fakeMarkdownTheme(theme),
		onClose: (action, refinement) => {
			actions.push(action);
			refinements.push(refinement);
		},
		requestRender: () => {
			renders += 1;
		},
		viewportRows: options.rows,
		tui: options.tui as NonNullable<PlanViewOptions["tui"]> | undefined,
	});
	return { component, actions, refinements, renders: () => renders };
}

/** The hint row: one above the closing rule. */
export function hintRow(component: PlanViewComponent, width: number): string {
	return renderReview(component, width).at(-2) ?? "";
}

/** The scroll row: one above the hint row and the closing rule. */
export function scrollRow(component: PlanViewComponent): string {
	return renderReview(component, 80).at(-3) ?? "";
}
