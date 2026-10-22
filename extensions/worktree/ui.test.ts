/**
 * The `/worktree` screen: rows, marks, verbs, and width bounds.
 *
 * The component is driven directly — no git, no fake `pi` — because the rows are
 * a `WorktreeSnapshot`, which `status.ts` already builds from real repositories
 * in `flow.test.ts`. What is worth asserting here is the vocabulary: which row is
 * current, what a dirty worktree says, what each verb asks the command to do, and
 * that nothing overflows its width.
 */

import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { GLYPHS } from "../../lib/tui/glyphs.ts";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import type { IsolationGap } from "./gaps.ts";
import type { CheckoutStatus } from "./registry.ts";
import { WorktreeListComponent, type WorktreeAction, type WorktreeScreenOptions, worktreeRows } from "./screen.ts";
import type { ManagedRow, WorktreeSnapshot } from "./status.ts";
import type { WorktreeState } from "./state.ts";

function status(overrides: Partial<CheckoutStatus> = {}): CheckoutStatus {
	const branch = overrides.branch ?? "worktree-alpha";
	return {
		path: "/repo/.pi/worktrees/alpha",
		branch,
		head: "5af3381aaaaaaaa",
		state: "clean",
		changed: 0,
		ahead: 0,
		behind: 0,
		merged: false,
		locked: false,
		staleLock: false,
		...overrides,
	};
}

function managed(name: string, overrides: Partial<CheckoutStatus> = {}): ManagedRow {
	const path = `/repo/.pi/worktrees/${name}`;
	const branch = `worktree-${name}`;
	return { entry: { path, branch }, status: status({ path, branch, ...overrides }) };
}

function activeWorktree(overrides: Partial<WorktreeState> = {}): WorktreeState {
	return {
		active: true,
		name: "alpha",
		path: "/repo/.pi/worktrees/alpha",
		branch: "worktree-alpha",
		repoRoot: "/repo",
		baseRef: "origin/main",
		baseRefMode: "fresh",
		createdByUs: true,
		...overrides,
	};
}

const SHELL_GAP: IsolationGap = {
	surface: "! shell",
	detail: "runs in the main checkout; Pi has no mutable session cwd",
};

function snapshot(overrides: Partial<WorktreeSnapshot> = {}): WorktreeSnapshot {
	return {
		active: null,
		gaps: [],
		inactiveOverrides: [],
		managed: [managed("alpha")],
		baseBranch: "main",
		...overrides,
	};
}

interface Built {
	component: WorktreeListComponent;
	actions: Array<WorktreeAction | undefined>;
	prunes: number;
	reloads: number;
}

function build(overrides: Partial<WorktreeSnapshot> = {}, options: Partial<WorktreeScreenOptions> = {}): Built {
	const actions: Array<WorktreeAction | undefined> = [];
	const built: Built = { component: undefined as never, actions, prunes: 0, reloads: 0 };
	built.component = new WorktreeListComponent({
		snapshot: snapshot(overrides),
		theme: fakeTheme,
		requestRender: () => {},
		onDone: (action) => actions.push(action),
		reload: async () => {
			built.reloads += 1;
			return snapshot(overrides);
		},
		prune: async () => {
			built.prunes += 1;
			return "Removed /repo/.pi/worktrees/old\nKept /repo/.pi/worktrees/busy";
		},
		readOnly: false,
		viewportRowsSource: 20,
		...options,
	});
	return built;
}

describe("worktreeRows", () => {
	test("marks the managed row the session is in", () => {
		const rows = worktreeRows(snapshot({ active: activeWorktree(), managed: [managed("alpha"), managed("beta")] }));
		expect(rows.map((row) => row.name)).toEqual(["alpha", "beta"]);
		expect(rows.map((row) => row.current)).toEqual([true, false]);
	});

	test("keeps an out-of-directory worktree visible as its own row", () => {
		const outside = activeWorktree({ name: "checked-out-by-hand", path: "/elsewhere/wt" });
		const rows = worktreeRows(snapshot({ active: outside }));
		expect(rows.map((row) => row.name)).toEqual(["checked-out-by-hand", "alpha"]);
		expect(rows[0]).toMatchObject({ current: true, status: undefined, path: "/elsewhere/wt" });
	});
});

describe("WorktreeListComponent", () => {
	test("renders the header, the rows, and their marks", () => {
		const { component } = build({
			managed: [managed("alpha"), managed("beta", { state: "dirty", changed: 2, ahead: 1 })],
		});
		const text = component.render(80).join("\n");
		expect(text).toContain("Worktrees");
		expect(text).toContain("alpha");
		expect(text).toContain("beta");
		expect(text).toContain("clean");
		expect(text).toContain(`${GLYPHS.warn}`);
		expect(text).toContain("dirty (2)");
		expect(text).toContain("ahead 1");
	});

	test("the current row says so, and the summary counts the list", () => {
		const { component } = build({
			active: activeWorktree(),
			managed: [managed("alpha"), managed("beta", { state: "dirty", changed: 1 })],
		});
		const text = component.render(80).join("\n");
		expect(text).toContain("current");
		expect(text).toContain("2 worktrees");
		expect(text).toContain("1 dirty");
	});

	test("names an override that leaves a tool un-isolated in the summary", () => {
		const { component } = build({ inactiveOverrides: ["bash"] });
		expect(component.render(100).join("\n")).toContain("not isolated: bash");
	});

	test("the focused row's block carries the path, the base, and the gaps", () => {
		const { component } = build({ active: activeWorktree(), gaps: [SHELL_GAP] });
		const text = component.render(100).join("\n");
		expect(text).toContain("/repo/.pi/worktrees/alpha");
		expect(text).toContain("base: origin/main (fresh)");
		expect(text).toContain("Not isolated:");
		expect(text).toContain("! shell");
	});

	test("every line fits its width", () => {
		const { component } = build({
			active: activeWorktree({ repoRoot: "/a/very/long/main/checkout/path/that/keeps/going/for/a/while" }),
			gaps: [SHELL_GAP],
			inactiveOverrides: ["bash", "powershell"],
			managed: [managed("alpha"), managed("a-very-long-worktree-name", { state: "dirty", changed: 12, ahead: 3 })],
		});
		for (const width of [30, 40, 60, 100]) {
			for (const line of component.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	test("shows an empty state when nothing is managed", () => {
		const { component } = build({ managed: [] });
		expect(component.render(80).join("\n")).toContain("No managed worktrees");
	});

	test("e enters the focused worktree when the session is not isolated", () => {
		const { component, actions } = build({ managed: [managed("alpha"), managed("beta")] });
		component.handleInput("j");
		component.handleInput("e");
		expect(actions).toEqual([{ kind: "enter", name: "beta" }]);
	});

	test("e on the current row is feedback, not an action", () => {
		const { component, actions } = build({ active: activeWorktree() });
		component.handleInput("e");
		expect(actions).toEqual([]);
		expect(component.render(80).join("\n")).toContain("already the current worktree");
	});

	test("e while still isolated asks for an exit first", () => {
		const { component, actions } = build({
			active: activeWorktree(),
			managed: [managed("alpha"), managed("beta")],
		});
		component.handleInput("j");
		component.handleInput("e");
		expect(actions).toEqual([]);
		expect(component.render(80).join("\n")).toContain("press x to exit first");
	});

	test("x asks the command to exit, and says so when there is nothing to exit", () => {
		const isolated = build({ active: activeWorktree() });
		isolated.component.handleInput("x");
		expect(isolated.actions).toEqual([{ kind: "exit" }]);

		const plain = build();
		plain.component.handleInput("x");
		expect(plain.actions).toEqual([]);
		expect(plain.component.render(80).join("\n")).toContain("Not in a worktree.");
	});

	test("p prunes in place and reports the first line", async () => {
		const built = build();
		built.component.handleInput("p");
		await Bun.sleep(1);
		expect(built.prunes).toBe(1);
		expect(built.reloads).toBe(1);
		expect(built.component.render(100).join("\n")).toContain("Removed /repo/.pi/worktrees/old");
	});

	test("a read-only screen refuses every verb", () => {
		const built = build({ active: activeWorktree() }, { readOnly: true });
		for (const key of ["e", "x", "p"]) built.component.handleInput(key);
		expect(built.actions).toEqual([]);
		expect(built.prunes).toBe(0);
		expect(built.component.render(100).join("\n")).toContain("Plan mode is read-only.");
	});

	test("opening a row shows its state and, ahead of base, the handoff command", () => {
		const { component } = build({
			managed: [managed("beta", { ahead: 2, state: "dirty", changed: 1 })],
		});
		component.handleInput("l");
		const text = component.render(100).join("\n");
		expect(text).toContain("branch  worktree-beta");
		expect(text).toContain("2 ahead");
		expect(text).toContain("git switch main && git merge --no-ff worktree-beta");
	});

	test("Escape closes the screen without an action", () => {
		const { component, actions } = build();
		component.handleInput("\u001b");
		expect(actions).toEqual([undefined]);
	});
});
