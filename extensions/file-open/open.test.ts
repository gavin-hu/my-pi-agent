import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildCommand, normalizeTarget, openTarget, resolveTarget } from "./open.ts";

describe("normalizeTarget", () => {
	test("unwraps an @ mention and surrounding quotes", () => {
		expect(normalizeTarget("@src/app.ts")).toBe("src/app.ts");
		expect(normalizeTarget('@"my file.txt"')).toBe("my file.txt");
		expect(normalizeTarget("'dir name'")).toBe("dir name");
	});

	test("trims surrounding whitespace", () => {
		expect(normalizeTarget("  src/app.ts  ")).toBe("src/app.ts");
	});

	test("strips control characters before they reach the handler", () => {
		expect(normalizeTarget("a\u001b[31mb")).toBe("a [31mb");
	});
});

describe("resolveTarget", () => {
	test("defaults an empty target to the working directory", () => {
		expect(resolveTarget(import.meta.dir, "   ")).toBe(import.meta.dir);
	});

	test("resolves a relative target against the root", () => {
		expect(resolveTarget(import.meta.dir, "open.ts")).toBe(join(import.meta.dir, "open.ts"));
	});

	test("keeps an absolute target", () => {
		const absolute = join(import.meta.dir, "schema.ts");
		expect(resolveTarget("/tmp", absolute)).toBe(absolute);
	});

	test("raises a readable error for a missing target", () => {
		expect(() => resolveTarget(import.meta.dir, "nope-missing")).toThrow(/does not exist/);
	});
});

describe("buildCommand", () => {
	test("macOS opens with open and reveals with -R", () => {
		expect(buildCommand("open", "/tmp/x", "darwin")).toEqual({ command: "open", args: ["/tmp/x"] });
		expect(buildCommand("reveal", "/tmp/x", "darwin")).toEqual({ command: "open", args: ["-R", "/tmp/x"] });
	});

	test("Windows opens with start and reveals with explorer /select", () => {
		expect(buildCommand("open", "C:\\x", "win32")).toEqual({
			command: "cmd",
			args: ["/c", "start", "", "C:\\x"],
		});
		expect(buildCommand("reveal", "C:\\x", "win32")).toEqual({
			command: "explorer",
			args: ["/select,C:\\x"],
		});
	});

	test("Linux opens with xdg-open and reveals the parent directory", () => {
		expect(buildCommand("open", "/tmp/dir/x", "linux")).toEqual({ command: "xdg-open", args: ["/tmp/dir/x"] });
		expect(buildCommand("reveal", "/tmp/dir/x", "linux")).toEqual({ command: "xdg-open", args: ["/tmp/dir"] });
	});
});

describe("openTarget", () => {
	test("runs the platform command through the injected launcher", () => {
		const calls: Array<[string, string[]]> = [];
		openTarget("open", "/tmp/x", { platform: "linux", spawn: (command, args) => calls.push([command, args]) });
		expect(calls).toEqual([["xdg-open", ["/tmp/x"]]]);
	});

	test("reports a launcher failure instead of throwing", () => {
		const errors: Error[] = [];
		openTarget("reveal", "/tmp/x", {
			platform: "darwin",
			spawn: () => {
				throw new Error("no handler");
			},
			onError: (error) => errors.push(error),
		});
		expect(errors.map((error) => error.message)).toEqual(["no handler"]);
	});
});
