import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { compareJobs, elapsedMs, formatJobDetail, jobCounts, shortLabel, statusGlyphChar } from "./format.ts";
import { JobListComponent, JobResult } from "./tui.ts";
import type { JobRecord } from "./types.ts";
import { fakeTheme } from "../../test/helpers/fakes.ts";

function record(overrides: Partial<JobRecord> = {}): JobRecord {
	return {
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
		stdin: false,
		sessionId: "s1",
		seen: false,
		lastLine: "",
		statusPath: null,
		startToken: null,
		...overrides,
	};
}

function makeComponent(
	jobs: JobRecord[],
	callbacks: Partial<{
		sessionId: () => string;
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
			sessionId: callbacks.sessionId ?? (() => "s1"),
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

describe("job tui format", () => {
	test("status glyphs are one terminal column wide", () => {
		for (const status of ["running", "exited", "killed", "failed", "unknown"] as const) {
			expect(visibleWidth(statusGlyphChar(status))).toBe(1);
		}
	});

	test("elapsed stops at finishedAt", () => {
		expect(elapsedMs(record({ startedAt: 100, finishedAt: 300 }), 9999)).toBe(200);
	});

	test("compareJobs sorts running before finished, then newest first", () => {
		const running = record({ id: "a", status: "running" });
		const old = record({ id: "b", status: "exited", startedAt: 1 });
		const recent = record({ id: "c", status: "exited", startedAt: 99 });
		expect([old, running, recent].sort(compareJobs).map((entry) => entry.id)).toEqual(["a", "c", "b"]);
	});

	test("shortLabel clips wide characters by display column, not code unit", () => {
		const label = "界".repeat(40); // 80 columns
		expect(visibleWidth(shortLabel(record({ label })))).toBeLessThanOrEqual(48);
	});

	test("jobCounts counts totals, running, and failed in one pass", () => {
		const jobs = [
			record({ id: "a", status: "running" }),
			record({ id: "b", status: "exited", exitCode: 0 }),
			record({ id: "c", status: "failed", exitCode: 1 }),
			record({ id: "d", status: "killed", signal: "SIGTERM" }),
		];
		expect(jobCounts(jobs)).toEqual({ total: 4, running: 1, failed: 1 });
	});

	test("formatJobDetail builds command, cwd+outcome+elapsed, and last lines", () => {
		const detail = formatJobDetail(record({ startedAt: 1000, finishedAt: 3200, lastLine: "compiled" }), 9000);
		expect(detail[0]).toBe("command: npm run build");
		expect(detail[1]).toBe("cwd: /repo · pid 1234 · 2.2s");
		expect(detail[2]).toBe("last: compiled");
	});

	test("formatJobDetail omits the last line when empty", () => {
		expect(formatJobDetail(record({ lastLine: "" }), 5000)).toHaveLength(2);
	});

	test("formatJobDetail strips ANSI from a malicious last line", () => {
		const detail = formatJobDetail(record({ lastLine: "\u001b[31mowned\u001b[0m" }), 5000);
		expect(detail[2]).toBe("last: owned");
		expect(detail[2]).not.toContain("\u001b");
	});

	test("formatJobDetail names the owner when another session owns the job", () => {
		expect(formatJobDetail(record({ sessionId: "peer" }), 5000, "me").join("\n")).toContain("owner: another session");
		expect(formatJobDetail(record({ sessionId: "me" }), 5000, "me").join("\n")).not.toContain("owner:");
	});
});

describe("JobResult", () => {
	test("tags another session's row in the transcript result", () => {
		const jobs = [record({ id: "j1", sessionId: "s1" }), record({ id: "j9", sessionId: "peer" })];
		const lines = new JobResult({ kind: "list", jobs, more: 0, sessionId: "s1" }, fakeTheme).render(70);
		expect(lines[1]).toContain("j1");
		expect(lines[1]).not.toContain("peer");
		expect(lines[2]).toContain("j9");
		expect(lines[2]).toContain("peer");
	});
});

describe("JobListComponent", () => {
	test("tags another session's job and refuses to kill it", () => {
		const { component, killed } = makeComponent([record({ id: "j9", sessionId: "peer" })], {});
		const text = component.render(60).join("\n");
		expect(text).toContain("peer");
		expect(text).toContain("1 peer");
		component.handleInput("d");
		expect(killed).toEqual([]);
		expect(component.render(60).join("\n")).toContain("j9 is another session's job; not killed.");
		// The refusal never opens a confirm, so a stray y cannot kill it either.
		component.handleInput("y");
		expect(killed).toEqual([]);
	});

	test("x clears only this session's finished jobs", () => {
		const jobs = [
			record({ id: "j1", status: "exited", exitCode: 0, pid: null, finishedAt: 5 }),
			record({ id: "j9", sessionId: "peer", status: "exited", exitCode: 0, pid: null, finishedAt: 5 }),
		];
		const { component, clearedCount } = makeComponent(jobs, {});
		component.handleInput("x");
		expect(component.render(80).join("\n")).toContain("Clear 1 finished job?");
		component.handleInput("y");
		expect(clearedCount()).toBe(1);
	});

	test("says so when only another session's jobs are finished", () => {
		const { component, clearedCount } = makeComponent(
			[record({ id: "j9", sessionId: "peer", status: "exited", exitCode: 0, pid: null, finishedAt: 5 })],
			{},
		);
		component.handleInput("x");
		expect(component.render(60).join("\n")).toContain("No finished jobs to clear.");
		expect(clearedCount()).toBe(0);
	});

	test("opens another session's log read-only", () => {
		const { component } = makeComponent([record({ id: "j9", sessionId: "peer" })], {
			logs: () => ({ lines: ["from the peer"] }),
		});
		component.handleInput("l");
		expect(component.currentLogId()).toBe("j9");
		expect(component.render(60).join("\n")).toContain("from the peer");
	});

	test("d asks for confirmation before killing the selected running job", () => {
		const { component, killed } = makeComponent([record()], {});
		component.handleInput("d");
		expect(killed).toEqual([]);
		expect(component.render(60).join("\n")).toContain("Kill j1");
		component.handleInput("y");
		expect(killed).toEqual(["j1"]);
	});

	test("d on a finished job reports it and never kills", () => {
		const { component, killed } = makeComponent([record({ status: "exited" })], {});
		component.handleInput("d");
		expect(component.render(60).join("\n")).toContain("j1 already exited");
		component.handleInput("y");
		expect(killed).toEqual([]);
	});

	test("x with nothing finished says so", () => {
		const { component, clearedCount } = makeComponent([record({ status: "running" })], {});
		component.handleInput("x");
		expect(component.render(60).join("\n")).toContain("No finished jobs to clear.");
		expect(clearedCount()).toBe(0);
	});

	test("x counts only finished jobs and warns about unreported results", () => {
		const jobs = [
			record({ id: "j1", status: "failed", exitCode: 1, seen: false }),
			record({ id: "j2", status: "exited", exitCode: 0, seen: true }),
			record({ id: "j3", status: "running" }),
		];
		const { component } = makeComponent(jobs, {});
		component.handleInput("x");
		const text = component.render(80).join("\n");
		expect(text).toContain("Clear 2 finished jobs?");
		expect(text).toContain("1 unreported result will be discarded.");
	});

	test("shows a counts summary and a focused detail pane", () => {
		const jobs = [
			record({ id: "j1", status: "running", lastLine: "compiled 42 modules" }),
			record({ id: "j0", status: "failed", exitCode: 1, pid: null, startedAt: -5000 }),
		];
		const { component } = makeComponent(jobs, {});
		const text = component.render(70).join("\n");
		expect(text).toContain("2 jobs · 1 running · 1 failed");
		expect(text).toContain("command: npm run build");
		expect(text).toContain("cwd: /repo · pid 1234");
		expect(text).toContain("last: compiled 42 modules");
	});

	test("shows whether the log pane follows the tail or is paused", () => {
		const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
		const { component } = makeComponent([record()], { logs: () => ({ lines }) });
		component.handleInput("l");
		expect(component.render(80).join("\n")).toContain("following");
		component.handleInput("\u001b[A"); // scroll up one line
		expect(component.render(80).join("\n")).toContain("paused");
	});

	test("the log header names the job", () => {
		const { component } = makeComponent([record()], { logs: () => ({ lines: [] }) });
		component.handleInput("l");
		expect(component.render(60).join("\n")).toContain("Job Logs · j1 build");
	});

	test("the log pane names the log file and notes a bounded tail", () => {
		const { component } = makeComponent([record()], { logs: () => ({ lines: ["a", "b"], more: true }) });
		component.handleInput("l");
		const text = component.render(80).join("\n");
		expect(text).toContain("/tmp/j1.log");
		expect(text).toContain("showing last 2 lines");
	});

	test("omits the tail note when the whole log fits", () => {
		const { component } = makeComponent([record()], { logs: () => ({ lines: ["a"], more: false }) });
		component.handleInput("l");
		const text = component.render(80).join("\n");
		expect(text).toContain("/tmp/j1.log");
		expect(text).not.toContain("showing last");
	});

	test("does not repaint the log pane when the tail is unchanged", () => {
		let renders = 0;
		const component = new JobListComponent(
			() => [record()],
			fakeTheme,
			{ sessionId: () => "s1", logs: () => ({ lines: ["a", "b"] }), kill: () => {}, clear: () => {} },
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
		const { component } = makeComponent([record()], { logs: () => ({ lines: [] }) });
		component.handleInput("l");
		expect(component.render(40).join("\n")).toContain("No output yet.");
	});

	test("log pane shows raw lines, not the model-facing header", () => {
		const { component } = makeComponent([record()], { logs: () => ({ lines: ["line one", "line two"] }) });
		component.handleInput("l");
		const text = component.render(40).join("\n");
		expect(text).toContain("line two");
		expect(text).not.toContain("output:");
	});
});
