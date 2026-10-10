import { describe, expect, test } from "bun:test";
import { buildInhibitorCommand, encodePowerShell, powershellScript } from "./inhibitor.ts";

const opts = (overrides: Partial<{ keepDisplay: boolean; piPid: number }> = {}) => ({
	keepDisplay: false,
	piPid: 4242,
	...overrides,
});

describe("buildInhibitorCommand", () => {
	test("uses caffeinate on macOS, following the Pi pid", () => {
		expect(buildInhibitorCommand("darwin", opts())).toBe("caffeinate -i -w 4242");
		expect(buildInhibitorCommand("darwin", opts({ keepDisplay: true }))).toBe("caffeinate -d -i -w 4242");
	});

	test("uses systemd-inhibit on Linux, watching the Pi pid", () => {
		const command = buildInhibitorCommand("linux", opts());
		expect(command).toContain("systemd-inhibit --what=sleep");
		expect(command).toContain("--mode=block");
		expect(command).toContain("kill -0 4242");
	});

	test("adds the idle inhibitor on Linux when keeping the display awake", () => {
		expect(buildInhibitorCommand("linux", opts({ keepDisplay: true }))).toContain("--what=idle:sleep");
	});

	test("uses an encoded PowerShell command on Windows", () => {
		const command = buildInhibitorCommand("win32", opts());
		expect(command).toStartWith("powershell -NoProfile -NonInteractive");
		expect(command).toContain("-EncodedCommand ");
	});

	test("returns undefined on unsupported platforms", () => {
		expect(buildInhibitorCommand("freebsd", opts())).toBeUndefined();
		expect(buildInhibitorCommand("aix", opts())).toBeUndefined();
	});
});

describe("powershellScript", () => {
	test("requests continuous system-required state and watches the pid", () => {
		const script = powershellScript(false, 4242);
		expect(script).toContain("SetThreadExecutionState(0x80000001)");
		expect(script).toContain("Get-Process -Id 4242");
		expect(script).not.toContain("0x80000003");
	});

	test("adds ES_DISPLAY_REQUIRED when keeping the display awake", () => {
		expect(powershellScript(true, 4242)).toContain("SetThreadExecutionState(0x80000003)");
	});
});

describe("encodePowerShell", () => {
	test("round-trips a script through UTF-16LE base64", () => {
		const script = powershellScript(true, 7);
		const decoded = Buffer.from(encodePowerShell(script), "base64").toString("utf16le");
		expect(decoded).toBe(script);
	});
});
