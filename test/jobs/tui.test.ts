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
	test("lists running jobs and hides when none run", () => {
		const widget = new JobsWidget(() => [job()], fakeTheme);
		expect(widget.render(40).length).toBeGreaterThan(1);
		const empty = new JobsWidget(() => [job({ status: "exited" })], fakeTheme);
		expect(empty.render(40)).toEqual([]);
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

	test("opening logs reads and renders the pane", () => {
		const { component } = makeComponent([job()], { logs: () => ({ lines: ["line one", "line two"] }) });
		component.handleInput("l");
		expect(component.currentLogId()).toBe("j1");
		expect(component.render(40).join("\n")).toContain("line two");
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

	test("header never exceeds a narrow viewport", () => {
		const { component } = makeComponent([job()], {});
		for (const line of component.render(8)) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(8);
		}
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
