import { describe, expect, test } from "bun:test";
import { basename } from "node:path";
import { parseArgs } from "./plan-review-shot.ts";

describe("parseArgs", () => {
	test("a plan path defaults the output to its stem", () => {
		const options = parseArgs(["docs/some-plan.md"]);
		expect(basename(options.plan)).toBe("some-plan.md");
		expect(basename(options.out)).toBe("some-plan.png");
		expect(options.width).toBe(1280);
		expect(options.scale).toBe(2);
		expect(options.theme).toBeUndefined();
	});

	test("flags override the defaults", () => {
		const options = parseArgs([
			"plan.md",
			"-o",
			"shot.png",
			"--width",
			"900",
			"--scale",
			"1",
			"--theme",
			"dark",
			"--wait",
			"100",
		]);
		expect(basename(options.out)).toBe("shot.png");
		expect(options.width).toBe(900);
		expect(options.scale).toBe(1);
		expect(options.theme).toBe("dark");
		expect(options.waitMs).toBe(100);
	});

	test("rejects a missing plan, an unknown flag, and bad values", () => {
		expect(() => parseArgs([])).toThrow("a plan path is required");
		expect(() => parseArgs(["plan.md", "--nope"])).toThrow("unknown option");
		expect(() => parseArgs(["plan.md", "--theme", "sepia"])).toThrow("--theme must be light or dark");
		expect(() => parseArgs(["plan.md", "--width", "10"])).toThrow("--width must be at least 320");
		expect(() => parseArgs(["plan.md", "--scale", "0"])).toThrow("--scale must be positive");
	});
});
