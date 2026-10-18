import { describe, expect, test } from "bun:test";
import type { WorktreeConfig } from "./config.ts";
import { gapLines, isolationGaps, type GapInput } from "./gaps.ts";
import { testConfig } from "../../test/helpers/fixtures/worktree.ts";

function input(overrides: Partial<GapInput> = {}): GapInput {
	return {
		platform: "linux",
		activeTools: ["read", "bash", "write", "edit"],
		config: testConfig() as WorktreeConfig,
		unverifiableCommands: 0,
		...overrides,
	};
}

const surfaces = (facts: GapInput): string[] => isolationGaps(facts).map((gap) => gap.surface);

describe("isolationGaps", () => {
	test("names the user's own shell and the unverifiable-command gap on any platform", () => {
		expect(surfaces(input())).toEqual(["! shell", "unverifiable"]);
	});

	test("never claims isolation for a command it let through unverified", () => {
		const gaps = isolationGaps(input({ unverifiableCommands: 2 }));
		const detail = gaps.find((gap) => gap.surface === "unverifiable")?.detail ?? "";
		expect(detail).toContain("pass through");
		expect(detail).toContain("2 ran this session");
	});

	test("leaves the count out when nothing ran unverified", () => {
		const gaps = isolationGaps(input());
		const detail = gaps.find((gap) => gap.surface === "unverifiable")?.detail ?? "";
		expect(detail).not.toContain("ran this session");
	});

	test("drops the unverifiable gap when the guard refuses those commands", () => {
		const config = testConfig({ guard: { blockUnparsableCommands: true } }) as WorktreeConfig;
		expect(surfaces(input({ config }))).toEqual(["! shell"]);
	});

	test("names powershell only on Windows, and only when the tool is active", () => {
		expect(surfaces(input({ platform: "win32", activeTools: ["read", "bash", "powershell"] }))).toEqual([
			"! shell",
			"powershell",
			"unverifiable",
		]);
		expect(surfaces(input({ platform: "win32", activeTools: ["read", "bash"] }))).toEqual(["! shell", "unverifiable"]);
		expect(surfaces(input({ platform: "darwin", activeTools: ["read", "bash", "powershell"] }))).toEqual([
			"! shell",
			"unverifiable",
		]);
	});
});

describe("gapLines", () => {
	test("prints nothing when there is nothing to report", () => {
		expect(gapLines([])).toEqual([]);
	});

	test("pads the labels to the longest surface", () => {
		expect(gapLines(isolationGaps(input({ platform: "win32", activeTools: ["powershell"] })))).toEqual([
			"  ! shell       runs in the main checkout; Pi has no mutable session cwd",
			"  powershell    not re-rooted or guarded; only the model's own tools are",
			"  unverifiable  $(...), backticks, eval, and sh -c pass through (blockUnparsableCommands is off)",
		]);
	});
});
