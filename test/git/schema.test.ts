import { describe, expect, test } from "bun:test";
import { buildGitArgs } from "../../extensions/git/schema.ts";

describe("buildGitArgs", () => {
	test("status", () => {
		expect(buildGitArgs({ action: "status" })).toEqual(["status", "--short", "--branch"]);
		expect(buildGitArgs({ action: "status", path: "src" })).toEqual(["status", "--short", "--branch", "--", "src"]);
	});

	test("diff options", () => {
		expect(buildGitArgs({ action: "diff", staged: true, stat: true })).toEqual([
			"diff",
			"--no-color",
			"--cached",
			"--stat",
		]);
		expect(buildGitArgs({ action: "diff", ref: "main..feature" })).toEqual(["diff", "--no-color", "main..feature"]);
	});

	test("log defaults and clamps the limit", () => {
		expect(buildGitArgs({ action: "log" })).toEqual(["log", "--oneline", "--no-color", "-n20"]);
		expect(buildGitArgs({ action: "log", limit: 5 })).toEqual(["log", "--oneline", "--no-color", "-n5"]);
		expect(buildGitArgs({ action: "log", limit: 999 })).toEqual(["log", "--oneline", "--no-color", "-n200"]);
	});

	test("path is passed after --", () => {
		expect(buildGitArgs({ action: "diff", path: "src/app.ts" })).toEqual(["diff", "--no-color", "--", "src/app.ts"]);
		expect(buildGitArgs({ action: "log", path: "src" })).toEqual([
			"log",
			"--oneline",
			"--no-color",
			"-n20",
			"--",
			"src",
		]);
	});

	test("show defaults to HEAD", () => {
		expect(buildGitArgs({ action: "show" })).toEqual(["show", "--no-color", "HEAD"]);
		expect(buildGitArgs({ action: "show", ref: "abc123" })).toEqual(["show", "--no-color", "abc123"]);
	});

	test("branch lists", () => {
		expect(buildGitArgs({ action: "branch" })).toEqual(["branch", "--all", "--no-color"]);
	});

	test("rejects option-injection refs", () => {
		expect(() => buildGitArgs({ action: "show", ref: "--upload-pack=touch /tmp/x" })).toThrow();
		expect(() => buildGitArgs({ action: "log", ref: "-c core.pager=x" })).toThrow();
		expect(() => buildGitArgs({ action: "diff", ref: "HEAD;rm" })).toThrow();
	});
});
