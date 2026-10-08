import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { JobListComponent, JobsWidget } from "../../extensions/jobs/tui.ts";
import type { JobRecord } from "../../extensions/jobs/types.ts";
import { fakeTheme } from "../helpers/fakes.ts";

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
	...overrides,
});

function makeComponent(
	jobs: JobRecord[],
	callbacks: Partial<{ logs: (id: string) => { lines: string[] }; kill: (id: string) => void; clear: () => void }>,
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

describe("JobsWidget", () => {
	test("shows one running line under a rails header", () => {
		const lines = new JobsWidget(() => [job()], fakeTheme).render(40);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("Jobs");
		expect(lines[0]).toContain("1 running");
	});

	test("hides when nothing runs and no failure waits", () => {
		const empty = new JobsWidget(() => [job({ status: "exited", exitCode: 0 })], fakeTheme);
		expect(empty.render(40)).toEqual([]);
	});

	test("stays mounted for an unreported failure", () => {
		const widget = new JobsWidget(() => [job({ status: "failed", exitCode: 1, pid: null, seen: false })], fakeTheme);
		const lines = widget.render(40);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("1 failed");
	});

	test("reports both running and failed on the one line", () => {
		const widget = new JobsWidget(
			() => [job(), job({ id: "j2", status: "failed", exitCode: 2, pid: null, seen: false })],
			fakeTheme,
		);
		const line = widget.render(40)[0];
		expect(line).toContain("1 running");
		expect(line).toContain("1 failed");
	});

	test("hides once the failure is seen", () => {
		const widget = new JobsWidget(() => [job({ status: "failed", exitCode: 1, seen: true })], fakeTheme);
		expect(widget.render(40)).toEqual([]);
	});

	test("fits a narrow width", () => {
		const widget = new JobsWidget(() => [job({ label: "a very long label here" })], fakeTheme);
		for (const line of widget.render(10)) expect(visibleWidth(line)).toBeLessThanOrEqual(10);
	});
});

describe("JobListComponent", () => {
	test("d kills the selected running job", () => {
		const { component, killed } = makeComponent([job()], {});
		component.handleInput("d");
		expect(killed).toEqual(["j1"]);
	});

	test("d does nothing for a finished job", () => {
		const { component, killed } = makeComponent([job({ status: "exited" })], {});
		component.handleInput("d");
		expect(killed).toEqual([]);
	});

	test("x clears finished jobs", () => {
		const { component, clearedCount } = makeComponent([job({ status: "exited" })], {});
		component.handleInput("x");
		expect(clearedCount()).toBe(1);
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
		const jobs = Array.from({ length: 20 }, (_, i) => job({ id: `j${i}`, status: "exited", exitCode: 0, startedAt: i }));
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
