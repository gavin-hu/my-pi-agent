import { describe, expect, test } from "bun:test";
import { basename } from "node:path";
import { parseArgs } from "./file-browse-shot.ts";

describe("parseArgs", () => {
	test("defaults to the fixture root, README.md, and file-browse.png", () => {
		const options = parseArgs([]);
		expect(options.root).toBeUndefined();
		expect(options.file).toBe("README.md");
		expect(basename(options.out)).toBe("file-browse.png");
		expect(options.width).toBe(1280);
		expect(options.scale).toBe(1);
		expect(options.theme).toBeUndefined();
		expect(options.waitMs).toBe(8000);
	});

	test("flags override the defaults", () => {
		const options = parseArgs([
			"--root",
			"docs",
			"--file",
			"guide.md",
			"-o",
			"shot.png",
			"--width",
			"900",
			"--scale",
			"2",
			"--theme",
			"light",
			"--wait",
			"100",
		]);
		expect(options.root).toEndWith("docs");
		expect(options.file).toBe("guide.md");
		expect(basename(options.out)).toBe("shot.png");
		expect(options.width).toBe(900);
		expect(options.scale).toBe(2);
		expect(options.theme).toBe("light");
		expect(options.waitMs).toBe(100);
	});

	test("a root-relative file is required", () => {
		expect(() => parseArgs(["--file", "/etc/passwd"])).toThrow("--file must be root-relative");
	});

	test("rejects an unusable theme or size", () => {
		expect(() => parseArgs(["--theme", "sepia"])).toThrow("--theme must be light or dark");
		expect(() => parseArgs(["--width", "10"])).toThrow("--width must be at least 320");
		expect(() => parseArgs(["--scale", "0"])).toThrow("--scale must be positive");
		expect(() => parseArgs(["--wait", "-1"])).toThrow("--wait must not be negative");
	});

	test("rejects a flag without a value and an unknown option", () => {
		expect(() => parseArgs(["--root"])).toThrow("--root needs a value");
		expect(() => parseArgs(["--nope"])).toThrow("unknown option --nope");
		expect(() => parseArgs(["extra"])).toThrow("unexpected argument extra");
	});
});
