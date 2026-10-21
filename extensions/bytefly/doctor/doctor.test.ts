import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { SHARED_CONFIG_FILE } from "../../../lib/config.ts";
import { NOTICE_TYPE } from "../../../lib/notice.ts";
import type { Finding } from "../../../lib/requirements.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { tempDir, withAgentDir } from "../../../test/helpers/env.ts";
import { coloringTheme, fakeTheme } from "../../../test/helpers/fakes.ts";
import { bootDoctor, failingExec, makeFinding, makeReport } from "../../../test/helpers/fixtures/doctor.ts";
import { makeTempTracker } from "../../../test/helpers/git.ts";
import { settle } from "../../../test/helpers/process.ts";
import { DEFAULT_CONFIG, loadConfig, normalizeConfig } from "./config.ts";
import {
	countFindings,
	detailLines,
	formatExtension,
	formatHeadline,
	formatReport,
	formatWarning,
	hasProblems,
	reportSeverity,
	severityGlyph,
	warningNotice,
} from "./format.ts";
import { createDoctorRuntime, notifySeam } from "./runtime.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const ok = makeReport("todo", [makeFinding("todo.json", "ok")]);
const missing = makeReport("worktree", [
	makeFinding("git", "missing", "not found on PATH — worktree isolation", "install git"),
]);

/** Wrap a raw doctor object in the bytefly.json document shape. */
const file = (doctor: Record<string, unknown>): Record<string, unknown> => ({ doctor });

/** A session cwd whose project document holds `doctor`/`notify`. */
function projectWith(contents: Record<string, unknown>): string {
	const cwd = temps.track(tempDir("bytefly-doctor-cwd-"));
	mkdirSync(join(cwd, CONFIG_DIR_NAME), { recursive: true });
	writeFileSync(join(cwd, CONFIG_DIR_NAME, SHARED_CONFIG_FILE), JSON.stringify(contents));
	return cwd;
}

describe("normalizeConfig", () => {
	test("returns the base when there is nothing to read", () => {
		expect(normalizeConfig(undefined, DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
		expect(normalizeConfig({}, DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
	});

	test("takes a boolean proactive flag", () => {
		expect(normalizeConfig({ proactive: false }, DEFAULT_CONFIG).proactive).toBe(false);
		expect(normalizeConfig({ proactive: "no" }, DEFAULT_CONFIG).proactive).toBe(true);
	});

	test("clamps the probe timeout and rejects nonsense", () => {
		expect(normalizeConfig({ timeoutMs: 50 }, DEFAULT_CONFIG).timeoutMs).toBe(100);
		expect(normalizeConfig({ timeoutMs: 999_999 }, DEFAULT_CONFIG).timeoutMs).toBe(30_000);
		expect(normalizeConfig({ timeoutMs: "soon" }, DEFAULT_CONFIG).timeoutMs).toBe(DEFAULT_CONFIG.timeoutMs);
	});

	test("keeps only usable skip names", () => {
		expect(normalizeConfig({ skip: ["wechat", "", 7, "  "] }, DEFAULT_CONFIG).skip).toEqual(["wechat"]);
		expect(normalizeConfig({ skip: "wechat" }, DEFAULT_CONFIG).skip).toEqual([]);
	});
});

describe("loadConfig", () => {
	test("reads the global bytefly.json from the agent directory", async () => {
		await withAgentDir(async (dir) => {
			writeFileSync(join(dir, "bytefly.json"), JSON.stringify(file({ proactive: false, timeoutMs: 500 })));
			const config = loadConfig("/nonexistent-cwd");
			expect(config.proactive).toBe(false);
			expect(config.timeoutMs).toBe(500);
		}, "bytefly-doctor-agent-");
	});

	test("ignores a malformed file, like every other config", async () => {
		await withAgentDir(async (dir) => {
			writeFileSync(join(dir, "bytefly.json"), "{ not json");
			expect(loadConfig("/nonexistent-cwd")).toEqual(DEFAULT_CONFIG);
		}, "bytefly-doctor-agent-");
	});
});

describe("report counts and headline", () => {
	test("counts only missing and degraded as problems", () => {
		const reports = [ok, missing, makeReport("web-access", [makeFinding("unpdf", "degraded")])];
		expect(countFindings(reports)).toEqual({ extensions: 3, enabled: 3, missing: 1, degraded: 1 });
		expect(hasProblems(reports)).toBe(true);
		expect(formatHeadline(reports)).toBe("doctor: 1 missing, 1 degraded across 3 extensions");
	});

	test("says everything is ready when it is", () => {
		const reports = [ok, makeReport("goal")];
		expect(hasProblems(reports)).toBe(false);
		expect(formatHeadline(reports)).toBe("doctor: all 2 enabled extensions are ready");
	});

	test("counts a disabled extension out of the ready total", () => {
		const reports = [ok, makeReport("wechat", [makeFinding("state", "info")], false)];
		expect(countFindings(reports).enabled).toBe(1);
		expect(formatHeadline(reports)).toBe("doctor: all 1 enabled extensions are ready");
	});
});

describe("report text", () => {
	test("lists only the extensions with problems, with their hints", () => {
		const text = formatReport([ok, missing]);
		expect(text).toContain("git: not found on PATH");
		expect(text).toContain("→ install git");
		expect(text).not.toContain("todo");
	});

	test("lists notes when nothing is wrong", () => {
		const text = formatReport([makeReport("bytefly", [makeFinding("platform", "info", "TUI only")])]);
		expect(text).toContain("Notes:");
		expect(text).toContain("bytefly: TUI only");
	});

	test("shows every finding, including passing checks, for one extension", () => {
		const text = formatExtension(makeReport("worktree", [makeFinding("git", "ok"), ...missing.findings]));
		expect(text).toContain("worktree");
		expect(text).toContain("git: git detail");
	});

	test("names the extension and the fix in the proactive warning", () => {
		expect(formatWarning(missing.findings)).toBe("doctor: missing worktree (git) — run /bytefly doctor");
	});

	test("sanitizes anything a probe produced", () => {
		const nasty = makeReport("worktree", [makeFinding("git", "missing", "failed\u001b[31m\u0007 to start")]);
		expect(formatReport([nasty])).not.toContain("\u001b");
		expect(formatReport([nasty])).not.toContain("\u0007");
	});
});

describe("the transcript notice", () => {
	const finding = (extension: string, check: string, hint?: string): Finding => ({
		extension,
		check,
		severity: "missing",
		detail: `${check} is not installed`,
		...(hint === undefined ? {} : { hint }),
	});

	test("is a visible notice whose content is the warning sentence", () => {
		const findings = [finding("worktree", "git", "install git")];
		const notice = warningNotice(findings);
		expect(notice.customType).toBe(NOTICE_TYPE);
		expect(notice.display).toBe(true);
		expect(notice.content).toBe(formatWarning(findings));
		expect(notice.content).toContain("run /bytefly doctor");
	});

	test("is one bad row per missing finding, titled with the count", () => {
		const two = warningNotice([finding("worktree", "git", "install git"), finding("web-access", "unpdf")]);
		expect(two.details.source).toBe("doctor");
		expect(two.details.title).toBe("2 missing prerequisites");
		expect(two.details.severity).toBe("bad");
		expect(two.details.items).toEqual([
			{ label: "worktree (git)", detail: "install git", severity: "bad" },
			{ label: "web-access (unpdf)", detail: "unpdf is not installed", severity: "bad" },
		]);

		expect(warningNotice([finding("worktree", "git")]).details.title).toBe("1 missing prerequisite");
	});

	test("sanitizes everything a probe produced", () => {
		const notice = warningNotice([finding("worktree\u001b[31m", "git", "run \u0007it")]);
		const text = `${notice.content}${JSON.stringify(notice.details)}`;
		expect(text).not.toContain("\u001b");
		expect(text).not.toContain("\u0007");
	});
});

describe("rows and detail", () => {
	test("severity is the worst finding in the report", () => {
		expect(reportSeverity(ok)).toBe("ok");
		expect(reportSeverity(missing)).toBe("missing");
		expect(reportSeverity(makeReport("web-access", [makeFinding("unpdf", "degraded")]))).toBe("degraded");
		expect(reportSeverity(makeReport("wechat", [], false))).toBe("info");
	});

	test("uses the shared severity glyphs", () => {
		expect(severityGlyph("missing", fakeTheme)).toBe(GLYPHS.cross);
		expect(severityGlyph("degraded", fakeTheme)).toBe(GLYPHS.warn);
		expect(severityGlyph("ok", fakeTheme)).toBe(GLYPHS.check);
		expect(severityGlyph("info", fakeTheme)).toBe(GLYPHS.disabled);
	});

	test("wraps detail to the width and caps it at the row budget", () => {
		const long = makeReport("worktree", [makeFinding("git", "missing", "x".repeat(200))]);
		const lines = detailLines(long, fakeTheme, 40, 3);
		expect(lines.length).toBe(3);
		expect(lines.at(-1)).toContain("…");
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(40);
	});

	test("shows the hint indented under its finding", () => {
		const lines = detailLines(missing, fakeTheme, 60, 4);
		expect(lines.join("\n")).toContain("→ install git");
	});

	test("shows notes only once the screen is expanded", () => {
		const report = makeReport("bytefly", [makeFinding("platform", "info", "TUI only")]);
		expect(detailLines(report, fakeTheme, 60, 4).join("\n")).toContain("no problems");
		expect(detailLines(report, fakeTheme, 60, 4, true).join("\n")).toContain("TUI only");
	});
});

describe("notifySeam", () => {
	test("reports the project document's method over the global one", async () => {
		await withAgentDir((agentDir) => {
			writeFileSync(join(agentDir, SHARED_CONFIG_FILE), JSON.stringify({ notify: { method: "auto" } }));
			const cwd = projectWith({ notify: { enabled: true, method: "toast" } });

			expect(notifySeam(cwd)()).toEqual({ enabled: true, method: "toast" });
		}, "bytefly-doctor-agent-");
	});

	test("reports the defaults when nothing is configured", async () => {
		await withAgentDir(() => {
			const cwd = temps.track(tempDir("bytefly-doctor-cwd-"));

			expect(notifySeam(cwd)()).toEqual({ enabled: false, method: "auto" });
		}, "bytefly-doctor-agent-");
	});

	test("ignores a malformed document instead of throwing", async () => {
		await withAgentDir(() => {
			const cwd = temps.track(tempDir("bytefly-doctor-cwd-"));
			mkdirSync(join(cwd, CONFIG_DIR_NAME), { recursive: true });
			writeFileSync(join(cwd, CONFIG_DIR_NAME, SHARED_CONFIG_FILE), "{ not json");

			expect(notifySeam(cwd)()).toEqual({ enabled: false, method: "auto" });
		}, "bytefly-doctor-agent-");
	});
});

describe("the published search provider", () => {
	/** A runtime whose probes record the seam values they saw. */
	function runtimeWith(overrides: Record<string, unknown> = {}) {
		const reached: string[] = [];
		const runtime = createDoctorRuntime({ exec: async () => ({ code: 0 }) } as never, {
			seams: {
				...overrides,
				reach: async (url: string) => {
					reached.push(url);
					return { ok: true };
				},
			},
		});
		return { runtime, reached };
	}

	test("hands the published facts to the probe, and only on a refresh does it reach", async () => {
		const { runtime, reached } = runtimeWith();
		runtime.configure({ cwd: projectWith({}), config: { proactive: false, timeoutMs: 2_000, skip: [] } });

		runtime.noteSearchFacts({
			provider: "searxng",
			reason: "explicit",
			configured: true,
			endpoint: "http://searx.local:8080",
			apiKeyEnv: null,
			keyConfigured: false,
		});

		const cheap = await runtime.probeAll();
		const webAccess = cheap.find((report) => report.extension === "web-access");
		expect(webAccess?.findings.some((finding) => finding.detail.includes("resolved to searxng"))).toBe(true);
		expect(reached).toEqual([]);

		const refreshed = await runtime.probeAll({ refresh: true });
		const after = refreshed.find((report) => report.extension === "web-access");
		expect(after?.findings.some((finding) => finding.check === "http://searx.local:8080")).toBe(true);
		expect(reached).toEqual(["http://searx.local:8080"]);
	});

	test("a reset forgets the published facts", async () => {
		const { runtime } = runtimeWith();
		runtime.configure({ cwd: projectWith({}), config: { proactive: false, timeoutMs: 2_000, skip: [] } });
		runtime.noteSearchFacts({
			provider: "brave",
			reason: "explicit",
			configured: false,
			endpoint: null,
			apiKeyEnv: "BRAVE_SEARCH_API_KEY",
			keyConfigured: false,
		});
		runtime.reset();

		const reports = await runtime.probeAll();
		const webAccess = reports.find((report) => report.extension === "web-access");
		expect(webAccess?.findings.some((finding) => finding.detail.includes("has not reported"))).toBe(true);
	});
});

describe("doctor tool wiring", () => {
	test("registers a read-only tool with an output schema and no legacy command", () => {
		const { fake } = bootDoctor();
		const tool = fake.tools.get("run_doctor");
		expect(tool).toBeDefined();
		expect(tool.annotations.readOnlyHint).toBe(true);
		// A read-only tool has nothing to be destructive about, so the hint is omitted.
		expect(tool.annotations.destructiveHint).toBeUndefined();
		expect(tool.outputSchema).toBeDefined();
		expect(fake.commands.has("doctor")).toBe(false);
	});

	test("reads the subject as the body and a refresh as faint", () => {
		const { fake } = bootDoctor();
		const tool = fake.tools.get("run_doctor");
		const line: string = tool
			.renderCall({ extension: "bytefly", refresh: true }, coloringTheme, { lastComponent: undefined })
			.render(80)[0];
		expect(line).toContain("[text]bytefly");
		expect(line).toContain("[dim] (refresh)");
	});
});

describe("proactive probe", () => {
	test("posts one transcript notice when an enabled extension is missing a hard requirement", async () => {
		const { fake, start, notices } = bootDoctor({ exec: failingExec, settings: { quietStartup: true } });
		await start();

		// It is a message in the flow, not a transient UI notification.
		expect(notices).toEqual([]);
		expect(fake.customMessages).toHaveLength(1);
		const { message } = fake.customMessages[0] as { message: any };
		expect(message.customType).toBe(NOTICE_TYPE);
		expect(message.display).toBe(true);
		expect(message.content).toContain("run /bytefly doctor");
		expect(message.details.source).toBe("doctor");
		expect(message.details.title).toMatch(/^\d+ missing prerequisites?$/);
		expect(message.details.items).toContainEqual(
			expect.objectContaining({ label: "worktree (git)", detail: expect.stringContaining("install git") }),
		);
	});

	test("returns from session_start before the probes finish", async () => {
		let open: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			open = resolve;
		});
		const { fake, start } = bootDoctor({
			exec: async () => {
				await gate;
				return { stdout: "", stderr: "", code: 127 };
			},
			settings: { quietStartup: true },
		});

		// The host awaits this handler, so it must not wait on a spawning probe.
		await start();
		expect(fake.customMessages).toEqual([]);

		open?.();
		await settle();
		expect(fake.customMessages).toHaveLength(1);
	});

	test("drops a probe that outlives its session", async () => {
		let open: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			open = resolve;
		});
		const { fake, start, stop } = bootDoctor({
			exec: async () => {
				await gate;
				return { stdout: "", stderr: "", code: 127 };
			},
			settings: { quietStartup: true },
		});

		await start();
		await stop();
		open?.();
		await settle();

		// The next session's probe would report on this one; nothing may land.
		expect(fake.customMessages).toEqual([]);
	});

	test("stays quiet when every hard requirement is met", async () => {
		const { fake, start, notices } = bootDoctor({ settings: { quietStartup: true } });
		await start();
		expect(notices).toEqual([]);
		expect(fake.customMessages).toEqual([]);
	});

	test("stays quiet when proactive checks are disabled", async () => {
		await withAgentDir(async (dir) => {
			writeFileSync(join(dir, "bytefly.json"), JSON.stringify({ doctor: { proactive: false } }));
			const { fake, start, notices } = bootDoctor({ exec: failingExec, settings: { quietStartup: true } });
			await start();
			expect(notices).toEqual([]);
			expect(fake.customMessages).toEqual([]);
		}, "bytefly-doctor-agent-");
	});

	test("stays quiet unless Pi's quietStartup is exactly true", async () => {
		for (const quietStartup of [false, "header", undefined]) {
			const { fake, start, notices } = bootDoctor({ exec: failingExec, settings: { quietStartup } });
			await start();
			expect(notices, JSON.stringify(quietStartup)).toEqual([]);
			expect(fake.customMessages, JSON.stringify(quietStartup)).toEqual([]);
		}
	});

	test("stays quiet without a UI to warn", async () => {
		const { fake, start, notices } = bootDoctor({ exec: failingExec, mode: "print", hasUI: false });
		await start();
		expect(notices).toEqual([]);
		expect(fake.customMessages).toEqual([]);
	});
});

describe("doctor session state", () => {
	test("drops the cached findings on shutdown", async () => {
		const { runtime, start, stop } = bootDoctor();
		await start();
		await runtime.probeAll();
		expect(runtime.peek()).toBeDefined();
		await stop();
		expect(runtime.peek()).toBeUndefined();
	});
});

describe("run_doctor", () => {
	test("returns typed findings and a text report", async () => {
		const { fake, ctx } = bootDoctor({ exec: failingExec });
		const tool = fake.tools.get("run_doctor");
		const result = await tool.execute("call-1", {}, undefined, undefined, ctx);

		expect(result.structuredContent.missing).toBeGreaterThan(0);
		expect(result.content[0].text).toContain("worktree");
		expect(result.details.headline).toContain("doctor:");
		const rewind = result.structuredContent.extensions.find(
			(entry: { extension: string }) => entry.extension === "rewind",
		);
		expect(rewind.findings.some((finding: { hint?: string }) => finding.hint?.includes("install git"))).toBe(true);
	});

	test("returns exactly the fields its output schema declares", async () => {
		const { fake, ctx } = bootDoctor({ exec: failingExec });
		const tool = fake.tools.get("run_doctor");
		const result = await tool.execute("call-1", {}, undefined, undefined, ctx);

		// The schema and the structured result are one contract: a field added to one
		// without the other would leave a caller reading a shape nobody promised.
		const declared = Object.keys(tool.outputSchema.properties as Record<string, unknown>).sort();
		expect(Object.keys(result.structuredContent).sort()).toEqual(declared);

		const severities = tool.outputSchema.properties.extensions.items.properties.findings.items.properties.severity
			.enum as string[];
		const allowed = new Set(severities);
		expect([...allowed].sort()).toEqual(["degraded", "info", "missing", "ok"]);
		for (const report of result.structuredContent.extensions) {
			for (const finding of report.findings) expect(allowed.has(finding.severity)).toBe(true);
		}
	});

	test("renders one summary line collapsed and the problems expanded", () => {
		const tool = bootDoctor().fake.tools.get("run_doctor");
		const details = {
			headline: "doctor: 1 missing, 0 degraded across 17 extensions",
			missing: 1,
			degraded: 0,
			extensions: [
				{
					extension: "todo",
					enabled: true,
					findings: [{ check: "node", severity: "missing", detail: "not on PATH", hint: "install node" }],
				},
			],
		};
		const render = (expanded: boolean): string =>
			tool
				.renderResult({ content: [], details }, { expanded }, fakeTheme, { lastComponent: undefined })
				.render(80)
				.join("\n");

		const collapsed = render(false);
		expect(collapsed).toContain("doctor: 1 missing");
		expect(collapsed).not.toContain("not on PATH");
		expect(collapsed.toLowerCase()).toContain("expand");
		expect(render(true)).toContain("not on PATH");
	});

	test("reports one extension when asked", async () => {
		const { fake, ctx } = bootDoctor();
		const tool = fake.tools.get("run_doctor");
		const result = await tool.execute("call-1", { extension: "todo" }, undefined, undefined, ctx);
		expect(result.structuredContent.extensions).toHaveLength(1);
		expect(result.structuredContent.extensions[0].extension).toBe("todo");
	});

	test("names the known extensions when asked for an unknown one", async () => {
		const { fake, ctx } = bootDoctor();
		const tool = fake.tools.get("run_doctor");
		await expect(tool.execute("call-1", { extension: "nope" }, undefined, undefined, ctx)).rejects.toThrow(
			/No extension named "nope"\. Known extensions: /,
		);
	});
});
