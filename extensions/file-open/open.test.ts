import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { buildCommand, normalizeTarget, openTarget, resolveTarget, type LauncherChild } from "./open.ts";

/** A child double whose `error` and `exit` events the test emits synchronously. */
function fakeChild() {
	const emitter = new EventEmitter();
	const spawn = (): LauncherChild => emitter;
	return { emitter, spawn };
}

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
		expect(buildCommand("open", "/tmp/x", "darwin")).toEqual({
			command: "open",
			args: ["/tmp/x"],
			exitMeansFailure: true,
		});
		expect(buildCommand("reveal", "/tmp/x", "darwin")).toEqual({
			command: "open",
			args: ["-R", "/tmp/x"],
			exitMeansFailure: true,
		});
	});

	test("Windows opens and reveals with explorer, without trusting its exit status", () => {
		expect(buildCommand("open", "C:\\x", "win32")).toEqual({
			command: "explorer",
			args: ["C:\\x"],
			exitMeansFailure: false,
		});
		expect(buildCommand("reveal", "C:\\x", "win32")).toEqual({
			command: "explorer",
			args: ["/select,C:\\x"],
			exitMeansFailure: false,
		});
	});

	test("Linux opens with xdg-open and reveals the parent directory", () => {
		expect(buildCommand("open", "/tmp/dir/x", "linux")).toEqual({
			command: "xdg-open",
			args: ["/tmp/dir/x"],
			exitMeansFailure: true,
		});
		expect(buildCommand("reveal", "/tmp/dir/x", "linux")).toEqual({
			command: "xdg-open",
			args: ["/tmp/dir"],
			exitMeansFailure: true,
		});
	});
});

describe("openTarget", () => {
	test("runs the platform command through the injected launcher", () => {
		const calls: Array<[string, string[]]> = [];
		openTarget("open", "/tmp/x", {
			platform: "linux",
			spawn: (command, args) => {
				calls.push([command, args]);
				return undefined;
			},
		});
		expect(calls).toEqual([["xdg-open", ["/tmp/x"]]]);
	});

	test("ignores a successful exit", () => {
		const { emitter, spawn } = fakeChild();
		const errors: Error[] = [];
		openTarget("open", "/tmp/x", { platform: "darwin", spawn, onError: (error) => errors.push(error) });

		emitter.emit("exit", 0, null);

		expect(errors).toEqual([]);
	});

	test("reports a non-zero exit as a failed launch", () => {
		const { emitter, spawn } = fakeChild();
		const errors: Error[] = [];
		openTarget("open", "/tmp/x", { platform: "darwin", spawn, onError: (error) => errors.push(error) });

		emitter.emit("exit", 1, null);

		expect(errors.map((error) => error.message)).toEqual(["the OS handler exited with status 1"]);
	});

	test("reports a signal that stopped the handler", () => {
		const { emitter, spawn } = fakeChild();
		const errors: Error[] = [];
		openTarget("open", "/tmp/x", { platform: "linux", spawn, onError: (error) => errors.push(error) });

		emitter.emit("exit", null, "SIGTERM");

		expect(errors.map((error) => error.message)).toEqual(["the OS handler was stopped by SIGTERM"]);
	});

	test("does not treat explorer's exit status as a failure", () => {
		const { emitter, spawn } = fakeChild();
		const errors: Error[] = [];
		openTarget("open", "C:\\x", { platform: "win32", spawn, onError: (error) => errors.push(error) });

		emitter.emit("exit", 1, null);

		expect(errors).toEqual([]);
	});

	test("reports only the first failure for one launch", () => {
		const { emitter, spawn } = fakeChild();
		const errors: Error[] = [];
		openTarget("open", "/tmp/x", { platform: "darwin", spawn, onError: (error) => errors.push(error) });

		emitter.emit("error", new Error("no handler"));
		emitter.emit("exit", 1, null);

		expect(errors.map((error) => error.message)).toEqual(["no handler"]);
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
