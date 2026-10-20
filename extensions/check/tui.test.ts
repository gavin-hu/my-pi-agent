import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { tempDir } from "../../test/helpers/env.ts";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import type { CheckResult, Failure } from "./types.ts";
import { CheckResultComponent, CheckRunComponent } from "./tui.ts";

const FAILURES: Failure[] = [
	{
		path: "extensions/check/detect.test.ts",
		line: 88,
		column: 5,
		message: "expected cargo test",
		command: "bun run check",
	},
	{ path: "extensions/check/failures.test.ts", line: 41, message: "expected 2 failures", command: "bun run check" },
	{ test: "TestDetect", message: "Test failed", command: "go test ./..." },
];

const RESULT: CheckResult = {
	target: "all",
	status: "failed",
	commands: ["bun run check"],
	exitCode: 1,
	durationMs: 12_400,
	truncated: false,
	failures: FAILURES,
	tail: "src/check.test.ts:12: nope\nmore output",
};

const dirs: string[] = [];
afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function resultText(component: CheckResultComponent, width = 80): string {
	return stripTerminalSequences(component.render(width).join("\n"));
}

/** Mount the result screen. */
function result(overrides: Partial<CheckResult> = {}, cwd = "/tmp") {
	const closed = { rerun: 0, close: 0 };
	const component = new CheckResultComponent({
		result: { ...RESULT, ...overrides },
		cwd,
		theme: fakeTheme,
		onRerun: () => {
			closed.rerun += 1;
		},
		onClose: () => {
			closed.close += 1;
		},
		requestRender: () => {},
		viewportRows: () => 40,
	});
	return { component, closed };
}

describe("CheckRunComponent", () => {
	test("tails the output, shows the command and elapsed time, and cancels", () => {
		const lines = ["$ bun run test", "✓ one", "✗ two"];
		let cancelled = 0;
		const component = new CheckRunComponent({
			command: "bun run test",
			lines: () => lines,
			elapsedMs: () => 3200,
			theme: fakeTheme,
			onCancel: () => {
				cancelled += 1;
			},
			requestRender: () => {},
			viewportRows: () => 20,
		});

		const screen = stripTerminalSequences(component.render(80).join("\n"));
		expect(screen).toContain("running");
		expect(screen).toContain("bun run test");
		expect(screen).toContain("✓ one");
		expect(screen).toContain("Esc cancel");

		component.handleInput("\u001b");
		expect(cancelled).toBe(1);
	});

	test("keeps every line within the width", () => {
		const component = new CheckRunComponent({
			command: "a very long command with a path and arguments",
			lines: () => ["+".repeat(300)],
			elapsedMs: () => 1000,
			theme: fakeTheme,
			onCancel: () => {},
			requestRender: () => {},
			viewportRows: () => 20,
		});

		for (const width of [24, 40, 80]) {
			for (const line of component.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});
});

describe("CheckResultComponent", () => {
	test("lists failures with their locations and the focused message", () => {
		const { component } = result();
		const screen = resultText(component);

		expect(screen).toContain("3 failures");
		expect(screen).toContain("bun run check");
		expect(screen).toContain("detect.test.ts:88:5");
		expect(screen).toContain("expected cargo test");
		expect(screen).toContain("Enter detail");
	});

	test("opens the detail pane and goes back with Escape", () => {
		const { component } = result();
		component.handleInput("\r");
		const detail = resultText(component);

		expect(detail).toContain("detect.test.ts:88:5 · bun run check");
		expect(detail).toContain("more output");
		expect(detail).toContain("Esc back");

		component.handleInput("\u001b");
		expect(resultText(component)).toContain("3 failures");
	});

	test("r reruns and Escape closes from the list", () => {
		const { component, closed } = result();
		component.handleInput("r");
		component.handleInput("\u001b");

		expect(closed.rerun).toBe(1);
		expect(closed.close).toBe(1);
	});

	test("reads the source around the focused failure", () => {
		const cwd = tempDir("pi-check-tui-source-");
		dirs.push(cwd);
		mkdirSync(join(cwd, "src"), { recursive: true });
		writeFileSync(join(cwd, "src", "a.ts"), Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n"));
		const { component } = result(
			{ failures: [{ path: "src/a.ts", line: 10, message: "nope", command: "bun run test" }] },
			cwd,
		);

		component.handleInput("\r");
		const screen = resultText(component);

		expect(screen).toContain("Source:");
		expect(screen).toContain("> 10 │ line 10");
		expect(screen).toContain("line 5");
		expect(screen).toContain("line 15");
	});

	test("renders an empty failure list without pretending it parsed", () => {
		const { component } = result({ failures: [] });

		expect(resultText(component)).toContain("No failures parsed.");
	});

	test("windows a long failure list", () => {
		const many: Failure[] = Array.from({ length: 60 }, (_, index) => ({
			path: `src/file-${String(index).padStart(2, "0")}.ts`,
			line: index + 1,
			message: `failure ${index}`,
			command: "bun run check",
		}));
		const { component } = result({ failures: many });

		const screen = resultText(component);
		expect(screen).toContain("of 60");
		expect(screen).not.toContain("file-59");
	});

	test("keeps every line within the width", () => {
		const long: Failure[] = [
			{
				path: `src/${"nested/".repeat(10)}a-very-long-failure-path.ts`,
				line: 123,
				message: "x".repeat(200),
				command: "bun run check",
			},
		];
		const { component } = result({ failures: long });

		for (const width of [24, 40, 80, 120]) {
			for (const line of component.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});
});
