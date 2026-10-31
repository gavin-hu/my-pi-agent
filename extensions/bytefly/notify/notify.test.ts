import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JOB_FINISHED_CHANNEL, type JobFinishedEvent, WATCH_MATCH_CHANNEL } from "../../../lib/events.ts";
import { tempDir, withAgentDir } from "../../../test/helpers/env.ts";
import { createFakePi, emit } from "../../../test/helpers/fakes.ts";
import { fakeFooterCtx } from "../../../test/helpers/fixtures/footer.ts";
import { makeTempTracker } from "../../../test/helpers/git.ts";
import { DEFAULT_NOTIFY_CONFIG, loadNotifyConfig, MAX_TITLE_LENGTH, normalizeNotifyConfig } from "./config.ts";
import { resolveMethod, sendNotification, type NotifySeams } from "./dispatch.ts";
import {
	formatInputBody,
	formatJobBody,
	formatTurnBody,
	formatWatchBody,
	MAX_WATCH_LINE,
	sessionLabel,
} from "./format.ts";
import { registerNotify } from "./register.ts";
import type { NotifyConfig, NotifyMethod } from "./types.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** Write a bytefly document into `dir`, creating it if needed. */
function writeDocument(dir: string, value: unknown): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "bytefly.json"), JSON.stringify(value));
}

function projectDir(): string {
	return temps.track(tempDir("bytefly-notify-"));
}

interface DeliveryRecorder {
	seams: NotifySeams;
	written: string[];
	ran: Array<{ command: string; args: string[] }>;
}

/** A seams double that records OSC writes and spawned notifier commands. */
function deliveryRecorder(
	options: { platform?: NodeJS.Platform; env?: Record<string, string | undefined>; isTTY?: boolean } = {},
): DeliveryRecorder {
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

const finished: JobFinishedEvent = { id: "j1", label: "build", status: "exited", exitCode: 0, signal: null };
const match = { count: 2, watcherId: "w3", label: "build", line: "error: bad thing" };

interface NotifyHarness {
	pi: any;
	ctx: any;
	written: string[];
	ran: Array<{ command: string; args: string[] }>;
	handle: { notify: (body: string) => void };
}

/**
 * Register the capability over recording seams with `notify` in `bytefly.json`,
 * start the session, and hand the live harness to `fn`. Everything runs inside
 * the temp agent directory, because `session_start` reads the config from it.
 */
async function scenario(
	notify: Record<string, unknown> | undefined,
	fn: (harness: NotifyHarness) => Promise<void>,
): Promise<void> {
	await withAgentDir(async (agentDir) => {
		if (notify) writeDocument(agentDir, { notify });
		const recorder = deliveryRecorder({ isTTY: true });
		const { pi } = createFakePi();
		const ctx = fakeFooterCtx({ mode: "tui", sessionName: "project" }).ctx;
		const handle = registerNotify(pi, { seams: recorder.seams });
		await emit(pi, "session_start", { reason: "startup" }, ctx);
		await fn({ pi, ctx, written: recorder.written, ran: recorder.ran, handle });
	}, "bytefly-notify-agent-");
}

describe("normalizeNotifyConfig", () => {
	test("returns the base for a missing object or an empty section", () => {
		expect(normalizeNotifyConfig(undefined, DEFAULT_NOTIFY_CONFIG)).toEqual(DEFAULT_NOTIFY_CONFIG);
		expect(normalizeNotifyConfig({}, DEFAULT_NOTIFY_CONFIG)).toEqual(DEFAULT_NOTIFY_CONFIG);
	});

	test("is off by default", () => {
		expect(DEFAULT_NOTIFY_CONFIG.enabled).toBe(false);
	});

	test("reads each flag and falls back on a wrong type", () => {
		const config = normalizeNotifyConfig(
			{ enabled: true, turnFinished: false, needsInput: "yes", jobFinished: true },
			DEFAULT_NOTIFY_CONFIG,
		);
		expect(config.enabled).toBe(true);
		expect(config.turnFinished).toBe(false);
		expect(config.needsInput).toBe(true);
		expect(config.jobFinished).toBe(true);
	});

	test("accepts a known method and rejects an unknown one", () => {
		expect(normalizeNotifyConfig({ method: "notify-send" }, DEFAULT_NOTIFY_CONFIG).method).toBe("notify-send");
		expect(normalizeNotifyConfig({ method: "carrier-pigeon" }, DEFAULT_NOTIFY_CONFIG).method).toBe("auto");
	});

	test("trims the title and clamps it to its label budget", () => {
		expect(normalizeNotifyConfig({ title: "  Deploy  " }, DEFAULT_NOTIFY_CONFIG).title).toBe("Deploy");
		expect(normalizeNotifyConfig({ title: "x".repeat(80) }, DEFAULT_NOTIFY_CONFIG).title).toHaveLength(
			MAX_TITLE_LENGTH,
		);
		expect(normalizeNotifyConfig({ title: "   " }, DEFAULT_NOTIFY_CONFIG).title).toBe("Pi");
	});
});

describe("loadNotifyConfig", () => {
	test("is off with no file at all", async () => {
		await withAgentDir(() => {
			expect(loadNotifyConfig(projectDir())).toEqual(DEFAULT_NOTIFY_CONFIG);
		}, "bytefly-notify-agent-");
	});

	test("layers the global file, then the project file over it", async () => {
		const cwd = projectDir();
		writeDocument(join(cwd, ".pi"), { notify: { enabled: true, method: "osc99" } });
		await withAgentDir((agentDir) => {
			writeDocument(agentDir, { notify: { enabled: false, method: "toast", title: "Build" } });
			const config = loadNotifyConfig(cwd);
			expect(config.enabled).toBe(true);
			expect(config.method).toBe("osc99");
			expect(config.title).toBe("Build");
		}, "bytefly-notify-agent-");
	});

	test("ignores a malformed file", async () => {
		const cwd = projectDir();
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "bytefly.json"), "{ not json");
		await withAgentDir(() => {
			expect(loadNotifyConfig(cwd)).toEqual(DEFAULT_NOTIFY_CONFIG);
		}, "bytefly-notify-agent-");
	});
});

describe("resolveMethod", () => {
	test("returns an explicit method unchanged", () => {
		expect(resolveMethod("osc99", deliveryRecorder().seams)).toBe("osc99");
	});

	const cases: Array<[string, Parameters<typeof deliveryRecorder>[0], NotifyMethod]> = [
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
			expect(resolveMethod("auto", deliveryRecorder(options).seams)).toBe(expected);
		});
	}
});

describe("sendNotification", () => {
	test("does nothing while the capability is off", () => {
		const r = deliveryRecorder({ isTTY: true });
		sendNotification({ ...DEFAULT_NOTIFY_CONFIG, enabled: false }, "Pi", "done", r.seams);
		expect(r.written).toEqual([]);
		expect(r.ran).toEqual([]);
	});

	test("writes an OSC 777 sequence on a TTY", () => {
		const r = deliveryRecorder({ isTTY: true });
		sendNotification(enabled({ method: "osc777" }), "Pi", "Turn finished", r.seams);
		expect(r.written).toEqual(["\x1b]777;notify;Pi;Turn finished\x07"]);
	});

	test("skips OSC 777 when stdout is not a TTY", () => {
		const r = deliveryRecorder({ isTTY: false });
		sendNotification(enabled({ method: "osc777" }), "Pi", "Turn finished", r.seams);
		expect(r.written).toEqual([]);
	});

	test("neutralizes control characters and semicolons in an OSC title", () => {
		const r = deliveryRecorder({ isTTY: true });
		sendNotification(enabled({ method: "osc777" }), "a\x07b;c", "line\x1b\nbreak", r.seams);
		expect(r.written).toEqual(["\x1b]777;notify;a b c;line break\x07"]);
	});

	test("writes the two-part OSC 99 sequence", () => {
		const r = deliveryRecorder({ isTTY: true });
		sendNotification(enabled({ method: "osc99" }), "Pi", "Waiting", r.seams);
		expect(r.written).toEqual(["\x1b]99;i=1:d=0;Pi\x1b\\", "\x1b]99;i=1:p=body;Waiting\x1b\\"]);
	});

	test("spawns the Windows toast script", () => {
		const r = deliveryRecorder({ platform: "win32" });
		sendNotification(enabled({ method: "toast" }), "Pi", "Job failed", r.seams);
		expect(r.ran).toHaveLength(1);
		expect(r.ran[0]?.command).toBe("powershell.exe");
		expect(r.ran[0]?.args).toContain("-Command");
		expect(r.ran[0]?.args.at(-1)).toContain("Job failed");
	});

	test("appends through the node list's Item(0), which PowerShell 5.1 accepts", () => {
		const r = deliveryRecorder({ platform: "win32" });
		sendNotification(enabled({ method: "toast" }), "Pi", "Job failed", r.seams);
		const script = r.ran[0]?.args.at(-1) ?? "";

		expect(script).toContain("$nodes = $xml.GetElementsByTagName('text')");
		expect(script).toContain("$nodes.Item(0).AppendChild");
		expect(script).not.toContain("GetElementsByTagName('text')[0]");
	});

	test("doubles a quote in the toast literals", () => {
		const r = deliveryRecorder({ platform: "win32" });
		sendNotification(enabled({ method: "toast" }), "Pi", "it's done", r.seams);
		expect(r.ran[0]?.args.at(-1)).toContain("it''s done");
	});

	test("runs osascript with a display notification", () => {
		const r = deliveryRecorder({ platform: "darwin" });
		sendNotification(enabled({ method: "osascript" }), "Pi", "Turn finished", r.seams);
		expect(r.ran[0]?.command).toBe("osascript");
		expect(r.ran[0]?.args).toEqual(["-e", 'display notification "Turn finished" with title "Pi"']);
	});

	test("runs notify-send with the title and body", () => {
		const r = deliveryRecorder({ platform: "linux" });
		sendNotification(enabled({ method: "notify-send" }), "Pi", "Job j1 failed", r.seams);
		expect(r.ran[0]).toEqual({ command: "notify-send", args: ["Pi", "Job j1 failed"] });
	});

	test("does nothing when the sanitized body is empty", () => {
		const r = deliveryRecorder({ isTTY: true });
		sendNotification(enabled({ method: "osc777" }), "Pi", " \x07 ", r.seams);
		expect(r.written).toEqual([]);
	});
});

describe("notification text", () => {
	const job = (overrides: Partial<JobFinishedEvent> = {}): JobFinishedEvent => ({ ...finished, ...overrides });

	test("sessionLabel prefers a sanitized session name", () => {
		expect(sessionLabel("feature\trefactor", "/home/u/repo/project")).toBe("feature refactor");
	});

	test("sessionLabel falls back to the cwd folder name", () => {
		expect(sessionLabel(undefined, "/home/u/repo/project")).toBe("project");
		expect(sessionLabel("", "/home/u/repo/project/")).toBe("project");
		expect(sessionLabel(undefined, "/")).toBe("session");
	});

	test("a finished turn names the session", () => {
		expect(formatTurnBody("project")).toBe("Turn finished · project");
	});

	test("an input prompt includes its title when it has one", () => {
		expect(formatInputBody("select", "Deploy where?", "project")).toBe(
			"Waiting for input (select): Deploy where? · project",
		);
		expect(formatInputBody("confirm", undefined, "project")).toBe("Waiting for input (confirm) · project");
	});

	test("a job body reads the ending, its exit code, and its label", () => {
		expect(formatJobBody(job())).toBe("Job j1 finished · build");
		expect(formatJobBody(job({ status: "failed", exitCode: 2 }))).toBe("Job j1 failed (2) · build");
		expect(formatJobBody(job({ status: "killed", exitCode: null, signal: "SIGTERM" }))).toBe(
			"Job j1 was killed · build",
		);
		expect(formatJobBody(job({ status: "unknown", exitCode: null }))).toBe("Job j1 finished · build");
		expect(formatJobBody(job({ label: "  " }))).toBe("Job j1 finished");
	});

	test("a watch body names the watcher and the newest matched line", () => {
		expect(formatWatchBody({ ...match, count: 1 })).toBe("1 watched line matched · w3 build: error: bad thing");
		expect(formatWatchBody({ ...match, count: 3 })).toContain("3 watched lines matched");
		expect(formatWatchBody({ ...match, count: 0 })).toContain("1 watched line matched");
		expect(formatWatchBody({ ...match, count: 1, label: "" })).toBe("1 watched line matched · w3: error: bad thing");
	});

	test("a watch body sanitizes and clips a watched line", () => {
		const unsafe = formatWatchBody({ ...match, line: "FAIL\u001b[31m: red" });
		expect(unsafe).not.toContain("\u001b");

		const body = formatWatchBody({ ...match, line: "x".repeat(MAX_WATCH_LINE + 40) });
		expect(body).toContain("x".repeat(MAX_WATCH_LINE));
		expect(body).not.toContain("x".repeat(MAX_WATCH_LINE + 1));
		expect(formatWatchBody({ ...match, count: 1, line: "\u0007" })).toBe("1 watched line matched · w3 build");
	});
});

describe("registerNotify — turn finished", () => {
	test("notifies once a run settles", async () => {
		await scenario({ enabled: true, method: "osc777" }, async (h) => {
			await emit(h.pi, "agent_settled", { aborted: false }, h.ctx);
			expect(h.written).toEqual(["\x1b]777;notify;Pi;Turn finished · project\x07"]);
		});
	});

	test("stays silent when the run was aborted", async () => {
		await scenario({ enabled: true, method: "osc777" }, async (h) => {
			await emit(h.pi, "agent_settled", { aborted: true }, h.ctx);
			expect(h.written).toEqual([]);
		});
	});

	test("honors turnFinished: false", async () => {
		await scenario({ enabled: true, method: "osc777", turnFinished: false }, async (h) => {
			await emit(h.pi, "agent_settled", { aborted: false }, h.ctx);
			expect(h.written).toEqual([]);
		});
	});

	test("stays silent while the capability is off", async () => {
		await scenario({ enabled: false, method: "osc777" }, async (h) => {
			await emit(h.pi, "agent_settled", { aborted: false }, h.ctx);
			expect(h.written).toEqual([]);
		});
	});
});

describe("registerNotify — needs input", () => {
	test("notifies for a prompt opened during a run", async () => {
		await scenario({ enabled: true, method: "osc777" }, async (h) => {
			await emit(h.pi, "agent_start", {}, h.ctx);
			await emit(h.pi, "ui_prompt_start", { kind: "select", title: "Deploy where?" }, h.ctx);
			expect(h.written).toEqual(["\x1b]777;notify;Pi;Waiting for input (select): Deploy where? · project\x07"]);
		});
	});

	test("stays silent for a prompt while idle", async () => {
		await scenario({ enabled: true, method: "osc777" }, async (h) => {
			await emit(h.pi, "ui_prompt_start", { kind: "custom", title: "Extensions" }, h.ctx);
			expect(h.written).toEqual([]);
		});
	});

	test("stops treating a run as active once it settles", async () => {
		await scenario({ enabled: true, method: "osc777" }, async (h) => {
			await emit(h.pi, "agent_start", {}, h.ctx);
			await emit(h.pi, "agent_settled", { aborted: false }, h.ctx);
			await emit(h.pi, "ui_prompt_start", { kind: "confirm", title: "Again?" }, h.ctx);
			expect(h.written).toHaveLength(1);
		});
	});
});

describe("registerNotify — background jobs", () => {
	test("notifies when the job extension announces a completion", async () => {
		await scenario({ enabled: true, method: "osc777" }, async (h) => {
			h.pi.events.emit(JOB_FINISHED_CHANNEL, finished);
			expect(h.written).toEqual(["\x1b]777;notify;Pi;Job j1 finished · build\x07"]);
		});
	});

	test("honors jobFinished: false", async () => {
		await scenario({ enabled: true, method: "osc777", jobFinished: false }, async (h) => {
			h.pi.events.emit(JOB_FINISHED_CHANNEL, finished);
			expect(h.written).toEqual([]);
		});
	});

	test("ignores a malformed payload", async () => {
		await scenario({ enabled: true, method: "osc777" }, async (h) => {
			h.pi.events.emit(JOB_FINISHED_CHANNEL, { id: "j1" });
			expect(h.written).toEqual([]);
		});
	});

	test("does not double-subscribe across a reload and drops the subscription on shutdown", async () => {
		await scenario({ enabled: true, method: "osc777" }, async (h) => {
			await emit(h.pi, "session_start", { reason: "reload" }, h.ctx);
			h.pi.events.emit(JOB_FINISHED_CHANNEL, finished);
			expect(h.written).toHaveLength(1);

			await emit(h.pi, "session_shutdown", { reason: "quit" }, h.ctx);
			h.pi.events.emit(JOB_FINISHED_CHANNEL, finished);
			expect(h.written).toHaveLength(1);
		});
	});
});

describe("registerNotify — watch matches", () => {
	test("notifies when the watch extension announces a wake match", async () => {
		await scenario({ enabled: true, method: "osc777" }, async (h) => {
			h.pi.events.emit(WATCH_MATCH_CHANNEL, match);
			expect(h.written).toEqual(["\x1b]777;notify;Pi;2 watched lines matched · w3 build: error: bad thing\x07"]);
		});
	});

	test("honors matchFound: false without touching the other triggers", async () => {
		await scenario({ enabled: true, method: "osc777", matchFound: false }, async (h) => {
			h.pi.events.emit(WATCH_MATCH_CHANNEL, match);
			expect(h.written).toEqual([]);

			h.pi.events.emit(JOB_FINISHED_CHANNEL, finished);
			expect(h.written).toHaveLength(1);
		});
	});

	test("ignores a malformed payload and a disabled capability", async () => {
		await scenario({ enabled: true, method: "osc777" }, async (h) => {
			h.pi.events.emit(WATCH_MATCH_CHANNEL, { count: 1, watcherId: "w1" });
			expect(h.written).toEqual([]);
		});
		await scenario({ enabled: false, method: "osc777" }, async (h) => {
			h.pi.events.emit(WATCH_MATCH_CHANNEL, match);
			expect(h.written).toEqual([]);
		});
	});

	test("drops the subscription on shutdown", async () => {
		await scenario({ enabled: true, method: "osc777" }, async (h) => {
			await emit(h.pi, "session_shutdown", { reason: "quit" }, h.ctx);
			h.pi.events.emit(WATCH_MATCH_CHANNEL, match);
			expect(h.written).toEqual([]);
		});
	});
});

describe("registerNotify — the handle", () => {
	test("sends one notification with the configured title when enabled", async () => {
		await scenario({ enabled: true, method: "osc777", title: "Build" }, async (h) => {
			h.handle.notify("Session budget reached · ¥1.00 of ¥1.00");
			expect(h.written).toEqual(["\x1b]777;notify;Build;Session budget reached · ¥1.00 of ¥1.00\x07"]);
		});
	});

	test("is inert while notifications are off", async () => {
		await scenario({ enabled: false, method: "osc777" }, async (h) => {
			h.handle.notify("Session budget reached");
			expect(h.written).toEqual([]);
		});
	});
});
