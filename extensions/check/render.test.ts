import { describe, expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { CheckResultBlock, COLLAPSED_ROWS } from "./render.ts";
import type { Failure, RunCheckDetails } from "./types.ts";

const FAILURE: Failure = {
	path: "src/a.ts",
	line: 12,
	column: 5,
	message: "expected 1 to be 2",
	command: "bun run check",
};

/** A details fixture. */
function details(overrides: Partial<RunCheckDetails> = {}): RunCheckDetails {
	return {
		target: "all",
		status: "failed",
		commands: ["bun run check"],
		exitCode: 1,
		durationMs: 12_400,
		truncated: false,
		failures: [FAILURE],
		tail: "",
		...overrides,
	};
}

/** Render a block to plain text. */
function text(overrides: Partial<RunCheckDetails> = {}, expanded = false, width = 80): string {
	const block = new CheckResultBlock({ details: details(overrides), expanded }, fakeTheme);
	return stripTerminalSequences(block.render(width).join("\n"));
}

/** `count` failures on distinct source lines. */
function manyFailures(count: number): Failure[] {
	return Array.from({ length: count }, (_, index) => ({ ...FAILURE, line: index + 1 }));
}

describe("check result block", () => {
	test("draws a pass in one line", () => {
		const out = text({ status: "passed", exitCode: 0, failures: [] });

		expect(out).toContain("✓");
		expect(out).toContain("passed · bun run check · 12.4s");
		expect(out.split("\n")).toHaveLength(1);
	});

	test("caps a collapsed failure list and offers the expand key", () => {
		const out = text({ failures: manyFailures(COLLAPSED_ROWS + 2) });

		expect(out).toContain("src/a.ts:5");
		expect(out).not.toContain("src/a.ts:6");
		expect(out).toContain("2 more failures");
		expect(out).toContain("to expand");
	});

	test("shows the model cap when expanded and points at the full screen", () => {
		const out = text({ failures: manyFailures(25) }, true);

		expect(out).toContain("src/a.ts:20");
		expect(out).not.toContain("src/a.ts:21");
		expect(out).toContain("5 more failures");
		expect(out).toContain("/check lists all");
	});

	test("names the command per row only when several commands ran", () => {
		expect(text({ failures: [FAILURE] })).not.toContain("bun run check · expected");
		expect(text({ commands: ["bun run test", "bun run lint"], failures: [FAILURE] })).toContain(
			"expected 1 to be 2 · bun run check",
		);
	});

	test("shows the tail instead of an exit-status row when nothing parsed", () => {
		const tail = Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join("\n");
		const out = text({
			exitCode: 2,
			failures: [{ message: "Command exited with status 2", command: "make verify" }],
			tail,
		});

		expect(out).not.toContain("Command exited with status 2");
		expect(out).toContain("failed · bun run check · 12.4s");
		expect(out).toContain("exit 2");
		expect(out).toContain("no parsed failure; last output:");
		expect(out).toContain("line 8");
		expect(out).not.toContain("line 3");
		expect(out).toContain("3 earlier lines");
	});

	test("shows the whole bounded tail when expanded", () => {
		const tail = Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join("\n");
		const out = text(
			{ exitCode: 2, failures: [{ message: "Command exited with status 2", command: "make verify" }], tail },
			true,
		);

		expect(out).toContain("line 1");
		expect(out).toContain("line 8");
		expect(out).not.toContain("earlier lines");
	});

	test("draws a timeout with its last output", () => {
		const out = text({ status: "timeout", exitCode: null, failures: [], tail: "hit the limit" });

		expect(out).toContain("timed out");
		expect(out).toContain("last output:");
		expect(out).toContain("hit the limit");
	});

	test("keeps a cancelled run to its summary", () => {
		const out = text({ status: "cancelled", exitCode: null, failures: [] });

		expect(out).toContain("cancelled");
		expect(out).not.toContain("last output:");
	});

	test("notes a truncated log", () => {
		expect(text({ truncated: true })).toContain("log truncated");
	});

	test("sanitizes a message and a command from command output", () => {
		const out = text({
			failures: [
				{
					path: "src/a.ts",
					line: 1,
					message: "bad \u001b[31mred\u001b[0m",
					command: "bun run \u0007check",
				},
			],
			commands: ["bun run \u001b[32mcheck"],
		});

		expect(out).not.toMatch(/[\u001b\u0007]/);
		expect(out).toContain("red");
	});

	test("fits every line at a narrow width", () => {
		const long = {
			...FAILURE,
			path: `src/${"deep/".repeat(10)}file.ts`,
			message: "a".repeat(300),
		};
		for (const width of [40, 80]) {
			const block = new CheckResultBlock(
				{ details: details({ failures: [long], tail: "b".repeat(300) }), expanded: true },
				fakeTheme,
			);
			for (const line of block.render(width)) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});
});
