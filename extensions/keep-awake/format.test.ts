import { describe, expect, test } from "bun:test";
import { overrideNotice, stateLabel, statusNotice } from "./format.ts";
import type { KeepAwakeStatus } from "./types.ts";

const status = (overrides: Partial<KeepAwakeStatus> = {}): KeepAwakeStatus => ({
	active: false,
	mode: "auto",
	holds: [],
	platform: "darwin",
	...overrides,
});

describe("stateLabel", () => {
	test("names the configured mode", () => {
		expect(stateLabel(status())).toBe("auto");
		expect(stateLabel(status({ mode: "always" }))).toBe("always");
	});

	test("reports a forced-on override", () => {
		expect(stateLabel(status({ override: "on" }))).toBe("on");
	});

	test("names a hold, which can keep the machine awake while idle in auto", () => {
		expect(stateLabel(status({ holds: ["wechat"] }))).toBe("hold");
		// A forced-on override still wins the label.
		expect(stateLabel(status({ override: "on", holds: ["wechat"] }))).toBe("on");
	});
});

describe("statusNotice", () => {
	test("reports an inactive state with the override and mode", () => {
		expect(statusNotice(status())).toBe("keep-awake: not holding the machine awake — override none, config auto.");
	});

	test("reports an active state", () => {
		expect(statusNotice(status({ active: true, override: "on" }))).toContain("holding the machine awake");
	});

	test("reports an unavailable inhibitor instead", () => {
		expect(statusNotice(status({ unavailable: "ENOENT" }))).toBe("keep-awake: unavailable (ENOENT).");
	});

	test("lists the owners holding the machine awake", () => {
		expect(statusNotice(status({ active: true, holds: ["wechat", "job"] }))).toContain("holds wechat, job");
	});
});

describe("overrideNotice", () => {
	test("describes on, off, and auto", () => {
		expect(overrideNotice("on", status())).toContain("will not sleep");
		expect(overrideNotice("off", status())).toContain("may sleep");
		expect(overrideNotice(undefined, status({ mode: "always" }))).toContain("for the session");
		expect(overrideNotice(undefined, status({ mode: "auto" }))).toContain("only while the agent is working");
	});

	test("names the holders when a hold is why auto is awake", () => {
		expect(overrideNotice(undefined, status({ holds: ["wechat"] }))).toContain("held by wechat");
	});

	test("reports an unavailable inhibitor instead", () => {
		expect(overrideNotice("on", status({ unavailable: "no caffeinate" }))).toBe(
			"keep-awake: unavailable (no caffeinate).",
		);
	});
});
