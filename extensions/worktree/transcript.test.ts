/**
 * The `worktree` tool's transcript block: what each action draws, and at what width.
 *
 * The extension had no renderer, so the block was bytefly's generic fallback printing the
 * result's model-facing text — a key/value dump for one worktree, and a listing whose marks
 * wrapped onto a second line. This suite holds the replacement to the density rule the block
 * grammar states: one row per fact, each fitting at 80, 48 and 40 columns.
 *
 * The last case is the interaction the change could break rather than add: a tool with no
 * renderer of its own still draws, through the same resolver that now answers `worktree`.
 */

import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createFakePi, fakeTheme as theme, toolRenderContext } from "../../test/helpers/fakes.ts";
import { registerTools } from "./tools.ts";

/** The widths a transcript is drawn at: wide, split, and narrow. */
const WIDTHS = [80, 48, 40];

/** The state entering hands back, and the one exit reads. */
const STATE = {
	active: true,
	name: "tool-gallery",
	path: "/repo/.pi/worktrees/tool-gallery",
	branch: "worktree-tool-gallery",
	repoRoot: "/repo",
	baseRef: "origin/main",
	baseRefMode: "head",
	createdByUs: true,
};

/** The `worktree` tool as Pi registers it, with no session and no git. */
function worktreeTool(): any {
	const fake = createFakePi();
	registerTools(fake.pi as any);
	const tool = fake.tools.get("worktree");
	if (!tool) throw new Error("the worktree tool was not registered");
	return tool;
}

/** One result, drawn collapsed or expanded at a width. */
function draw(tool: any, details: unknown, width: number, expanded = false): string[] {
	const result = { content: [{ type: "text", text: "the model's copy" }], details };
	return tool
		.renderResult(result, { expanded, isPartial: false }, theme, toolRenderContext({ expanded }))
		.render(width);
}

/** One call line at a width. */
function call(tool: any, args: Record<string, unknown>, width: number): string[] {
	return tool.renderCall(args, theme, toolRenderContext()).render(width);
}

/** Every line fits the width it was drawn at. */
function expectFits(lines: string[], width: number): void {
	for (const line of lines) expect(visibleWidth(line), line).toBeLessThanOrEqual(width);
}

describe("the worktree block", () => {
	test("entering draws the branch and the path in one row, at every width", () => {
		const tool = worktreeTool();
		for (const width of WIDTHS) {
			const lines = draw(tool, { action: "enter", state: STATE }, width);
			expect(lines, `${width} columns`).toHaveLength(1);
			// The worktree's name is its identity and survives every clip; the branch and the
			// whole relative path fit only where there are columns for them.
			expect(lines[0]).toContain("tool-gallery");
			if (width === 80) {
				expect(lines[0]).toContain("worktree-tool-gallery");
				expect(lines[0]).toContain(".pi/worktrees/tool-gallery");
			}
			expectFits(lines, width);
		}
	});

	test("leaving says whether the worktree was removed, at every width", () => {
		const tool = worktreeTool();
		for (const width of WIDTHS) {
			const removed = draw(tool, { action: "exit", state: STATE, removed: true }, width);
			expect(removed, `${width} columns`).toHaveLength(1);
			expect(removed[0]).toContain("Exited tool-gallery");
			expect(removed[0]).toContain("removed");
			expectFits(removed, width);

			const kept = draw(tool, { action: "exit", state: STATE, removed: false }, width);
			expect(kept[0]).toContain("kept");
			expectFits(kept, width);
		}
	});

	test("a handoff keeps its lines under the verdict instead of being folded", () => {
		const tool = worktreeTool();
		const handoff = "Merge it:\n  git switch main && git merge --no-ff worktree-tool-gallery";
		const lines = draw(tool, { action: "exit", state: STATE, removed: false, handoff }, 80);
		expect(lines.length).toBe(3);
		expect(lines[1]).toContain("Merge it:");
		expect(lines[2]).toContain("git merge --no-ff");
	});

	test("one row per managed worktree, each keeping its marks, at every width", () => {
		const tool = worktreeTool();
		const details = {
			action: "list",
			active: { path: STATE.path, branch: STATE.branch, borrowed: false },
			inactiveOverrides: [],
			managed: [
				{
					name: "tool-gallery",
					path: ".pi/worktrees/tool-gallery",
					branch: "worktree-tool-gallery",
					marks: ["current", "clean"],
				},
				{
					name: "feature-auth",
					path: ".pi/worktrees/feature-auth",
					branch: "worktree-feature-auth",
					marks: ["dirty (4)", "ahead 2"],
				},
				{
					name: "fix-typo",
					path: ".pi/worktrees/fix-typo",
					branch: "worktree-fix-typo",
					marks: ["merged", "used 3d ago"],
				},
			],
		};
		for (const width of WIDTHS) {
			const lines = draw(tool, details, width);
			// The block grammar's leading blank, then one row per worktree: the marks are the
			// answer, so a narrow terminal may not lose them to a wrap or a clip.
			expect(lines.length, `${width} columns`).toBe(4);
			expect(lines[1], `${width} columns`).toContain("current, clean");
			expect(lines[2], `${width} columns`).toContain("dirty (4), ahead 2");
			expect(lines[3], `${width} columns`).toContain("merged, used 3d ago");
			expectFits(lines, width);
		}
	});

	test("a list past the cap folds the rest into a hint, and expanding draws them all", () => {
		const tool = worktreeTool();
		const managed = Array.from({ length: 9 }, (_, index) => ({
			name: `w${index + 1}`,
			path: `.pi/worktrees/w${index + 1}`,
			branch: `worktree-w${index + 1}`,
			marks: ["clean"],
		}));
		const details = { action: "list", active: null, inactiveOverrides: [], managed };
		const collapsed = draw(tool, details, 80);
		expect(collapsed.some((line) => line.includes("… 4 more"))).toBe(true);
		const expanded = draw(tool, details, 80, true);
		expect(expanded.some((line) => line.includes("more"))).toBe(false);
		expect(expanded.some((line) => line.includes("w9"))).toBe(true);
	});

	test("a prune names what it removed and why a worktree was kept, at every width", () => {
		const tool = worktreeTool();
		const details = {
			action: "prune",
			removed: ["/repo/.pi/worktrees/feature-auth", "/repo/.pi/worktrees/fix-typo"],
			kept: ["/repo/.pi/worktrees/busy (has work)"],
		};
		for (const width of WIDTHS) {
			const lines = draw(tool, details, width);
			expect(lines, `${width} columns`).toHaveLength(3);
			expect(lines[0]).toContain("feature-auth");
			expect(lines[2]).toContain("has work");
			expectFits(lines, width);
		}
	});

	test("a cancelled enter draws the sentence the person chose, not an error", () => {
		const tool = worktreeTool();
		const lines = draw(tool, { cancelled: true }, 80);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("the model's copy");
	});

	test("the call line names the verb and carries the name it was given", () => {
		const tool = worktreeTool();
		for (const width of WIDTHS) {
			expect(call(tool, { action: "enter", name: "tool-gallery" }, width)[0]).toContain("tool-gallery");
			expect(call(tool, { action: "exit", remove: true }, width)[0]).toContain("remove");
			expect(call(tool, { action: "list" }, width)[0]).toContain("list");
			expectFits(call(tool, { action: "enter", name: "tool-gallery" }, width), width);
		}
	});
});
