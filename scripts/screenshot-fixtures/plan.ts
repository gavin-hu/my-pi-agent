/**
 * The plan the review screen shows, and the digests the previous review saw.
 *
 * Its `Steps` section changed on this review, so exactly one section reads as
 * changed against the baseline.
 */

import { sectionDigests } from "../../extensions/plan/plan-text.ts";
import type { StoredPlan } from "../../extensions/plan/plans.ts";

/** The plan the review screen shows; its `Steps` section changed on this review. */
export const PLAN_PATH = "/home/u/repo/.pi/plans/2026-10-18-1430-plan-review-change-marks.md";
export const PLAN_CONTENT = [
	"# Plan review: mark the sections that changed",
	"",
	"## Goal",
	"",
	"Show a returning reviewer what changed since the last review, without leaving the plan review screen.",
	"",
	"## Context",
	"",
	"- The body renders through Pi's `Markdown`, so headings, lists, and code already match the rest.",
	"- What is missing for a second review is the notice that a section was revised, and a position readout.",
	"",
	"## Approach",
	"",
	"- Persist the per-section digests of the reviewed plan with the approval.",
	"- Diff the new plan against them and mark every heading that changed.",
	"- Draw the scroll gauge from the shared kit, with `n`/`p` section jumps.",
	"- Rejected: comparing whole plans, because one edited word would flag every section.",
	"",
	"## Visual",
	"",
	"The scroll row on a second review:",
	"",
	"```",
	"▰▰▰▰▰▱▱▱▱▱ 52%  ≡ Steps · changed  lines 12–31 of 42",
	"```",
	"",
	"## Steps",
	"",
	"- [x] Store the review baseline alongside the approval",
	"  - `runtime.ts` already persists the mode entry; this adds one field to it.",
	"- [x] Diff sections on the next review",
	"- [x] Draw the gauge from the shared kit",
	"- [ ] Mark changed headings in the section label",
	"- [ ] Cover a second review in `tui.test.ts`",
	"",
	"## Risks",
	"",
	"- A plan edited outside Pi has no baseline, so the marks only appear on a second review.",
	"- The digests add state to the approval entry, which `/resume` must rebuild.",
	"",
	"## Verification",
	"",
	"```bash",
	"bun test extensions/plan",
	"bun run check",
	"```",
].join("\n");
export const PLAN: StoredPlan = {
	path: PLAN_PATH,
	relativePath: ".pi/plans/2026-10-18-1430-plan-review-change-marks.md",
	content: PLAN_CONTENT,
	bytes: Buffer.byteLength(PLAN_CONTENT),
};
/**
 * The digests the previous review saw: the same plan before its two newest
 * steps, so exactly one section — `Steps` — reads as changed.
 */
export const PLAN_BASELINE = sectionDigests(
	PLAN_CONTENT.replace(
		"- [ ] Mark changed headings in the section label\n- [ ] Cover a second review in `tui.test.ts`\n",
		"",
	),
);
