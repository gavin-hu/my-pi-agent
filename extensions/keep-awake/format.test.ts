import { describe, expect, test } from "bun:test";
import { overrideNotice, stateLabel, statusNotice } from "./format.ts";
import type { KeepAwakeStatus } from "./types.ts";

const status = (overrides: Partial<KeepAwakeStatus> = {}): KeepAwakeStatus => ({
	active: false,
	mode: "auto",
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
});

describe("overrideNotice", () => {
	test("describes on, off, and auto", () => {
		expect(overrideNotice("on", status())).toContain("will not sleep");
		expect(overrideNotice("off", status())).toContain("may sleep");
		expect(overrideNotice(undefined, status({ mode: "always" }))).toContain("for the session");
		expect(overrideNotice(undefined, status({ mode: "auto" }))).toContain("only while the agent is working");
	});

	test("reports an unavailable inhibitor instead", () => {
		expect(overrideNotice("on", status({ unavailable: "no caffeinate" }))).toBe(
			"keep-awake: unavailable (no caffeinate).",
		);
	});
});
