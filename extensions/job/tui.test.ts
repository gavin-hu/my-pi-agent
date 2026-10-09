import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { JobListComponent, JobResult } from "./tui.ts";
import type { JobRecord } from "./types.ts";
import { fakeTheme } from "../../test/helpers/fakes.ts";

const job = (overrides: Partial<JobRecord> = {}): JobRecord => ({
	id: "j1",
	label: "build",
	command: "npm run build",
	cwd: "/repo",
	pid: 1234,
	status: "running",
	exitCode: null,
	signal: null,
	startedAt: 0,
	finishedAt: null,
	logPath: "/tmp/j1.log",
	detached: false,
	wake: false,
	sessionId: "s1",
	seen: false,
	lastLine: "",
	statusPath: null,
	startToken: null,
	...overrides,
});

function makeComponent(
	jobs: JobRecord[],
	callbacks: Partial<{
		logs: (id: string) => { lines: string[]; more?: boolean };
		kill: (id: string) => void;
		clear: () => void;
	}>,
	rows = 12,
) {
	const killed: string[] = [];
	let cleared = 0;
	const component = new JobListComponent(
		() => jobs,
		fakeTheme,
		{
			logs: callbacks.logs ?? (() => ({ lines: [] })),
			kill: callbacks.kill ?? ((id) => killed.push(id)),
			clear:
				callbacks.clear ??
				(() => {
					cleared++;
				}),
		},
		() => {},
		() => {},
		rows,
	);
	return { component, killed, clearedCount: () => cleared };
}

describe("JobResult", () => {
	test("blank line then the list rail with a cap note", () => {
		const jobs = [job({ id: "j1" }), job({ id: "j2", status: "failed", exitCode: 1, pid: null })];
		const lines = new JobResult({ kind: "list", jobs, more: 2 }, fakeTheme).render(60);
		expect(lines[0]).toBe("");
		expect(lines[1]).toContain("▸ j1");
		expect(lines[2]).toContain("✗ j2");
		expect(lines[3]).toContain("… 2 more");
	});

	test("blank line then the log tail", () => {
		const lines = new JobResult({ kind: "logs", lines: ["a", "b"], earlier: 5 }, fakeTheme).render(60);
		expect(lines[0]).toBe("");
		expect(lines[1]).toBe("… 5 earlier lines");
		expect(lines[2]).toBe("a");
		expect(lines[3]).toBe("b");
	});

	test("updates in place for reuse", () => {
		const view = new JobResult({ kind: "logs", lines: ["old"], earlier: 0 }, fakeTheme);
		view.setInput({ kind: "logs", lines: ["new"], earlier: 0 }, fakeTheme);
		expect(view.render(60)).toEqual(["", "new"]);
	});
});

describe("JobListComponent", () => {
	test("d asks for confirmation before killing the selected running job", () => {
		const { component, killed } = makeComponent([job()], {});
		component.handleInput("d");
		expect(killed).toEqual([]);
		expect(component.render(60).join("\n")).toContain("Kill j1");
		component.handleInput("y");
		expect(killed).toEqual(["j1"]);
	});

	test("n cancels a pending kill", () => {
		const { component, killed } = makeComponent([job()], {});
		component.handleInput("d");
		component.handleInput("n");
		expect(killed).toEqual([]);
		expect(component.render(60).join("\n")).not.toContain("Kill j1");
	});

	test("d does nothing for a finished job", () => {
		const { component, killed } = makeComponent([job({ status: "exited" })], {});
		component.handleInput("d");
		component.handleInput("y");
		expect(killed).toEqual([]);
	});

	test("x asks for confirmation before clearing finished jobs", () => {
		const { component, clearedCount } = makeComponent([job({ status: "exited" })], {});
		component.handleInput("x");
		expect(clearedCount()).toBe(0);
		component.handleInput("y");
		expect(clearedCount()).toBe(1);
	});

	test("x counts only finished jobs and warns about unreported results", () => {
		const jobs = [
			job({ id: "j1", status: "failed", exitCode: 1, seen: false }),
			job({ id: "j2", status: "exited", exitCode: 0, seen: true }),
			job({ id: "j3", status: "running" }),
		];
		const { component } = makeComponent(jobs, {});
		component.handleInput("x");
		const text = component.render(80).join("\n");
		expect(text).toContain("Clear 2 finished jobs?");
		expect(text).toContain("1 unreported result will be discarded.");
	});

	test("selection follows the job id when the list re-sorts", () => {
		let jobs = [
			job({ id: "j1", label: "one", status: "running", startedAt: 0 }),
			job({ id: "j2", label: "two", status: "running", startedAt: 1 }),
		];
		const { component } = makeComponent(jobs, {}, 12);
		// ordered newest-first: j2 then j1; select the second row (j1).
		component.handleInput("j");
		expect(component.render(40).find((line) => line.startsWith("❯"))).toContain("j1");
		// j2 finishes and sinks below the still-running j1: j1's index changes.
		jobs = [
			job({ id: "j1", label: "one", status: "running", startedAt: 0 }),
			job({ id: "j2", label: "two", status: "exited", exitCode: 0, startedAt: 1, finishedAt: 5, pid: null }),
		];
		expect(component.render(40).find((line) => line.startsWith("❯"))).toContain("j1");
	});

	test("keeps the log pane on its job when the list re-sorts", () => {
		let jobs = [job({ id: "j1", status: "running", startedAt: 0 }), job({ id: "j2", status: "running", startedAt: 1 })];
		const { component } = makeComponent(jobs, { logs: () => ({ lines: ["x"] }) });
		// First row is j2; open its log.
		component.handleInput("l");
		expect(component.currentLogId()).toBe("j2");
		// j2 finishes and sinks, so index 0 now points at j1.
		jobs = [
			job({ id: "j1", status: "running", startedAt: 0 }),
			job({ id: "j2", status: "exited", exitCode: 0, startedAt: 1, finishedAt: 5, pid: null }),
		];
		expect(component.currentLogId()).toBe("j2");
	});

	test("shows a counts summary and a focused detail pane", () => {
		const jobs = [
			job({ id: "j1", status: "running", lastLine: "compiled 42 modules" }),
			job({ id: "j0", status: "failed", exitCode: 1, pid: null, startedAt: -5000 }),
		];
		const { component } = makeComponent(jobs, {});
		const text = component.render(70).join("\n");
		expect(text).toContain("2 jobs · 1 running · 1 failed");
		expect(text).toContain("command: npm run build");
		expect(text).toContain("cwd: /repo · pid 1234");
		expect(text).toContain("last: compiled 42 modules");
	});

	test("opening logs reads and renders the pane", () => {
		const { component } = makeComponent([job()], { logs: () => ({ lines: ["line one", "line two"] }) });
		component.handleInput("l");
		expect(component.currentLogId()).toBe("j1");
		expect(component.render(40).join("\n")).toContain("line two");
	});

	test("the log header names the job", () => {
		const { component } = makeComponent([job()], { logs: () => ({ lines: [] }) });
		component.handleInput("l");
		expect(component.render(60).join("\n")).toContain("Job Logs · j1 build");
	});

	test("the log pane names the log file and notes a bounded tail", () => {
		const { component } = makeComponent([job()], { logs: () => ({ lines: ["a", "b"], more: true }) });
		component.handleInput("l");
		const text = component.render(80).join("\n");
		expect(text).toContain("/tmp/j1.log");
		expect(text).toContain("showing last 2 lines");
	});

	test("omits the tail note when the whole log fits", () => {
		const { component } = makeComponent([job()], { logs: () => ({ lines: ["a"], more: false }) });
		component.handleInput("l");
		const text = component.render(80).join("\n");
		expect(text).toContain("/tmp/j1.log");
		expect(text).not.toContain("showing last");
	});

	test("does not repaint the log pane when the tail is unchanged", () => {
		let renders = 0;
		const component = new JobListComponent(
			() => [job()],
			fakeTheme,
			{ logs: () => ({ lines: ["a", "b"] }), kill: () => {}, clear: () => {} },
			() => {},
			() => {
				renders++;
			},
			12,
		);
		component.handleInput("l");
		const afterOpen = renders;
		component.refreshLogs("j1"); // identical tail
		expect(renders).toBe(afterOpen);
		component.setLogs("j1 build", ["a", "c"]); // changed tail
		expect(renders).toBe(afterOpen + 1);
	});

	test("shows the no-output note for an empty log tail", () => {
		const { component } = makeComponent([job()], { logs: () => ({ lines: [] }) });
		component.handleInput("l");
		expect(component.render(40).join("\n")).toContain("No output yet.");
	});

	test("log pane shows raw lines, not the model-facing header", () => {
		const { component } = makeComponent([job()], { logs: () => ({ lines: ["line one", "line two"] }) });
		component.handleInput("l");
		const text = component.render(40).join("\n");
		expect(text).toContain("line two");
		expect(text).not.toContain("output:");
	});

	test("clamps scroll when the list shrinks under it", () => {
		let jobs = Array.from({ length: 20 }, (_, i) => job({ id: `j${i}`, status: "exited", exitCode: 0, startedAt: i }));
		const component = new JobListComponent(
			() => jobs,
			fakeTheme,
			{ logs: () => ({ lines: [] }), kill: () => {}, clear: () => {} },
			() => {},
			() => {},
			12, // visible = 4
		);
		for (let i = 0; i < 10; i++) component.handleInput("j");
		jobs = jobs.slice(18);
		const rendered = component.render(40).join("\n");
		expect(rendered).toContain("j19");
		expect(rendered).toContain("j18");
		expect(rendered).not.toMatch(/showing \d+–\d+ of 2/);
	});

	test("pages and jumps the selection", () => {
		const jobs = Array.from({ length: 20 }, (_, i) =>
			job({ id: `j${i}`, status: "exited", exitCode: 0, startedAt: i }),
		);
		const { component } = makeComponent(jobs, {}, 12);
		component.render(40);
		component.handleInput("\u001b[6~"); // page down
		component.handleInput("\u001b[F"); // end
		expect(component.render(40).join("\n")).toContain("j0"); // newest finished sorts first
		component.handleInput("\u001b[H"); // home
		expect(component.render(40).join("\n")).toContain("j19"); // oldest finished sorts last
	});

	test("header never exceeds a narrow viewport", () => {
		const { component } = makeComponent([job()], {});
		for (const line of component.render(8)) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(8);
		}
	});

	test("the wheel moves the selection", () => {
		const jobs = Array.from({ length: 10 }, (_, i) =>
			job({ id: `j${i}`, label: `label${i}`, status: "exited", exitCode: 0, startedAt: i }),
		);
		const { component } = makeComponent(jobs, {}, 12);
		component.render(40);
		expect(component.handleMouse({ type: "wheel", wheelDelta: 1 } as any)).toEqual({ handled: true });
		const selected = component.render(40).find((line) => line.startsWith("❯"));
		expect(selected).toContain("label8");
		expect(component.handleMouse({ type: "click", button: "left" } as any)).toBeUndefined();
	});

	test("keeps the close hint on a narrow list screen", () => {
		const { component } = makeComponent([job()], {});
		const text = component.render(60).join("\n");
		expect(text).toContain("Esc close");
		expect(text).not.toContain("x clear finished");
	});

	test("keeps the back hint on a narrow log screen", () => {
		const { component } = makeComponent([job()], { logs: () => ({ lines: ["a"] }) });
		component.handleInput("l");
		const text = component.render(30).join("\n");
		expect(text).toContain("Esc back");
		expect(text).not.toContain("PgUp/PgDn");
	});

	test("escape closes the screen from list mode", () => {
		let closed = 0;
		const component = new JobListComponent(
			() => [job()],
			fakeTheme,
			{ logs: () => ({ lines: [] }), kill: () => {}, clear: () => {} },
			() => {
				closed++;
			},
			() => {},
			12,
		);
		component.handleInput("\u001b");
		expect(closed).toBe(1);
	});
});
