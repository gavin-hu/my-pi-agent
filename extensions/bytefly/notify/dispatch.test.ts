import { describe, expect, test } from "bun:test";
import { DEFAULT_NOTIFY_CONFIG } from "./config.ts";
import { resolveMethod, sendNotification, type NotifySeams } from "./dispatch.ts";
import type { NotifyConfig, NotifyMethod } from "./types.ts";

interface Recorder {
	seams: NotifySeams;
	written: string[];
	ran: Array<{ command: string; args: string[] }>;
}

/** A seams double that records OSC writes and spawned notifier commands. */
function recorder(
	options: { platform?: NodeJS.Platform; env?: Record<string, string | undefined>; isTTY?: boolean } = {},
): Recorder {
	const written: string[] = [];
	const ran: Array<{ command: string; args: string[] }> = [];
	return {
		written,
		ran,
		seams: {
			platform: options.platform ?? "linux",
			env: options.env ?? {},
			stdout: {
				write: (chunk: string) => {
					written.push(chunk);
					return true;
				},
				isTTY: options.isTTY ?? false,
			},
			run: (command, args) => ran.push({ command, args }),
		},
	};
}

/** An enabled config over the defaults. */
function enabled(overrides: Partial<NotifyConfig> = {}): NotifyConfig {
	return { ...DEFAULT_NOTIFY_CONFIG, enabled: true, ...overrides };
}

describe("resolveMethod", () => {
	test("returns an explicit method unchanged", () => {
		expect(resolveMethod("osc99", recorder().seams)).toBe("osc99");
	});

	const cases: Array<[string, Parameters<typeof recorder>[0], NotifyMethod]> = [
		["Windows Terminal", { env: { WT_SESSION: "1" } }, "toast"],
		["Kitty", { env: { KITTY_WINDOW_ID: "1" } }, "osc99"],
		["WezTerm", { env: { TERM_PROGRAM: "WezTerm" } }, "osc777"],
		["iTerm2", { env: { TERM_PROGRAM: "iTerm.app" } }, "osc777"],
		["Ghostty", { env: { GHOSTTY_RESOURCES_DIR: "/x" } }, "osc777"],
		["a plain Windows host", { platform: "win32" }, "toast"],
		["a Linux TTY", { platform: "linux", isTTY: true }, "osc777"],
		["a headless macOS host", { platform: "darwin" }, "osascript"],
		["a headless Linux host", { platform: "linux" }, "notify-send"],
	];

	for (const [name, options, expected] of cases) {
		test(`auto picks ${expected} for ${name}`, () => {
			expect(resolveMethod("auto", recorder(options).seams)).toBe(expected);
		});
	}
});

describe("sendNotification", () => {
	test("does nothing while the capability is off", () => {
		const r = recorder({ isTTY: true });
		sendNotification({ ...DEFAULT_NOTIFY_CONFIG, enabled: false }, "Pi", "done", r.seams);
		expect(r.written).toEqual([]);
		expect(r.ran).toEqual([]);
	});

	test("writes an OSC 777 sequence on a TTY", () => {
		const r = recorder({ isTTY: true });
		sendNotification(enabled({ method: "osc777" }), "Pi", "Turn finished", r.seams);
		expect(r.written).toEqual(["\x1b]777;notify;Pi;Turn finished\x07"]);
	});

	test("skips OSC 777 when stdout is not a TTY", () => {
		const r = recorder({ isTTY: false });
		sendNotification(enabled({ method: "osc777" }), "Pi", "Turn finished", r.seams);
		expect(r.written).toEqual([]);
	});

	test("neutralizes control characters and semicolons in an OSC title", () => {
		const r = recorder({ isTTY: true });
		sendNotification(enabled({ method: "osc777" }), "a\x07b;c", "line\x1b\nbreak", r.seams);
		expect(r.written).toEqual(["\x1b]777;notify;a b c;line break\x07"]);
	});

	test("writes the two-part OSC 99 sequence", () => {
		const r = recorder({ isTTY: true });
		sendNotification(enabled({ method: "osc99" }), "Pi", "Waiting", r.seams);
		expect(r.written).toEqual(["\x1b]99;i=1:d=0;Pi\x1b\\", "\x1b]99;i=1:p=body;Waiting\x1b\\"]);
	});

	test("spawns the Windows toast script", () => {
		const r = recorder({ platform: "win32" });
		sendNotification(enabled({ method: "toast" }), "Pi", "Job failed", r.seams);
		expect(r.ran).toHaveLength(1);
		expect(r.ran[0]?.command).toBe("powershell.exe");
		expect(r.ran[0]?.args).toContain("-Command");
		expect(r.ran[0]?.args.at(-1)).toContain("Job failed");
	});

	test("doubles a quote in the toast literals", () => {
		const r = recorder({ platform: "win32" });
		sendNotification(enabled({ method: "toast" }), "Pi", "it's done", r.seams);
		expect(r.ran[0]?.args.at(-1)).toContain("it''s done");
	});

	test("runs osascript with a display notification", () => {
		const r = recorder({ platform: "darwin" });
		sendNotification(enabled({ method: "osascript" }), "Pi", "Turn finished", r.seams);
		expect(r.ran[0]?.command).toBe("osascript");
		expect(r.ran[0]?.args).toEqual(["-e", 'display notification "Turn finished" with title "Pi"']);
	});

	test("runs notify-send with the title and body", () => {
		const r = recorder({ platform: "linux" });
		sendNotification(enabled({ method: "notify-send" }), "Pi", "Job j1 failed", r.seams);
		expect(r.ran[0]).toEqual({ command: "notify-send", args: ["Pi", "Job j1 failed"] });
	});

	test("does nothing when the sanitized body is empty", () => {
		const r = recorder({ isTTY: true });
		sendNotification(enabled({ method: "osc777" }), "Pi", " \x07 ", r.seams);
		expect(r.written).toEqual([]);
	});
});
