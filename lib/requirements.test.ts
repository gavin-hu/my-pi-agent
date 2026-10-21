/**
 * The runtime-prerequisite table and the optional-integration seams: the pure
 * probe over injected seams, the default-browser opener, the lazy `unpdf`
 * extractor, and the nested-`pi` invocation rule.
 *
 * No process, package, or network is touched: every probe runs through a seam,
 * and the one path that exists is a file in this directory.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { browserCommand, openInBrowser } from "./browser.ts";
import type { WebSearchProviderEvent } from "./events.ts";
import { PdfUnavailableError, extractPdfText, pdfExtractorFromModule, pdfGuidance, pdfTextFromResult } from "./pdf.ts";
import { getPiInvocation, type PiRuntime } from "./pi-invocation.ts";
import {
	ageInDays,
	canDeliver,
	hardRequirementExtensions,
	missingFindings,
	PROBE_CONCURRENCY,
	probeAll,
	probeExtension,
	type ProbeSeams,
	REQUIREMENTS,
	type ExtensionReport,
} from "./requirements.ts";

// --- The prerequisite probe -------------------------------------------------

/** The directories the seams resolve against, and the paths they produce. */
const AGENT_DIR = "/agent";
const CWD = "/repo";
const CONFIG_DIR = ".pi";
const agentPath = (file: string): string => join(AGENT_DIR, file);
const projectPath = (file: string): string => join(CWD, CONFIG_DIR, file);

/** Seams with everything satisfied unless a test overrides one. */
function seams(overrides: Partial<ProbeSeams> = {}): ProbeSeams {
	return {
		exec: async () => ({ code: 0 }),
		readJson: () => ({ state: "absent" }),
		dirs: { agentDir: AGENT_DIR, cwd: CWD, configDirName: CONFIG_DIR },
		platform: "darwin",
		isEnabled: () => true,
		loadModule: async () => ({}),
		invocation: () => ({ command: "pi", args: ["--version"] }),
		...overrides,
	};
}

/** The finding for one check label, or undefined. */
function find(report: ExtensionReport, check: string) {
	return report.findings.find((finding) => finding.check === check);
}

describe("binary checks", () => {
	test("reports git as satisfied for rewind", async () => {
		const report = await probeExtension("rewind", seams());
		expect(find(report, "git")?.severity).toBe("ok");
	});

	test("describes git in terms of the extension that needs it", async () => {
		const expected: Record<string, string> = {
			worktree: "worktree isolation",
			rewind: "rewind snapshots",
			plan: "project-local `.pi/plans` (otherwise plans land in the agent directory)",
			"file-browse": "the branch chip and the diff view",
			memory: "project-scope memory under the repository root",
		};
		for (const [name, enables] of Object.entries(expected)) {
			const report = await probeExtension(name, seams());
			expect(find(report, "git")?.detail, name).toBe(enables);
		}
	});

	test("declares no git check for an extension that never runs git", async () => {
		const report = await probeExtension("document", seams());
		expect(find(report, "git")).toBeUndefined();
	});

	test("reports a missing binary with its install hint", async () => {
		const report = await probeExtension("rewind", seams({ exec: async () => ({ code: 1 }) }));
		const finding = find(report, "git");
		expect(finding?.severity).toBe("missing");
		expect(finding?.detail).toContain("not found on PATH");
		expect(finding?.hint).toContain("install git");
	});

	test("treats a throwing exec seam as a missing binary", async () => {
		const report = await probeExtension(
			"worktree",
			seams({
				exec: async () => {
					throw new Error("spawn ENOENT");
				},
			}),
		);
		expect(find(report, "git")?.severity).toBe("missing");
	});
});

describe("optional package checks", () => {
	test("reports a missing optional package as degraded, not missing", async () => {
		const report = await probeExtension(
			"web-access",
			seams({
				loadModule: async () => {
					throw new Error("Cannot find module 'unpdf'");
				},
			}),
		);
		expect(find(report, "unpdf")?.severity).toBe("degraded");
		expect(find(report, "unpdf")?.hint).toContain("npm i unpdf");
	});
});

describe("state checks", () => {
	test("reports missing credentials with the login hint", async () => {
		const report = await probeExtension("wechat", seams());
		const finding = find(report, agentPath(join("wechat", "credentials.json")));
		expect(finding?.severity).toBe("degraded");
		expect(finding?.hint).toContain("/wechat login");
	});

	test("reports unreadable credentials with the reason", async () => {
		const report = await probeExtension(
			"wechat",
			seams({ readJson: () => ({ state: "error", error: "Unexpected token" }) }),
		);
		expect(find(report, agentPath(join("wechat", "credentials.json")))?.detail).toContain("Unexpected token");
	});
});

describe("config file checks", () => {
	test("says nothing when no config file exists", async () => {
		const report = await probeExtension("bytefly", seams());
		expect(report.findings.some((finding) => finding.check.endsWith(".json"))).toBe(false);
	});

	test("names a malformed project config and the parse error", async () => {
		const report = await probeExtension(
			"bytefly",
			seams({
				readJson: (path) =>
					path === projectPath("bytefly.json")
						? { state: "error", error: "Unexpected token 'n'" }
						: { state: "absent" },
			}),
		);
		const finding = find(report, projectPath("bytefly.json"));
		expect(finding?.severity).toBe("degraded");
		expect(finding?.detail).toContain("not valid JSON");
		expect(finding?.detail).toContain("Unexpected token");
	});

	test("distinguishes the global and project scopes", async () => {
		const report = await probeExtension(
			"bytefly",
			seams({
				readJson: (path) =>
					path === agentPath("bytefly.json") ? { state: "error", error: "bad json" } : { state: "absent" },
			}),
		);
		expect(find(report, agentPath("bytefly.json"))?.detail).toContain("the global config is ignored");
	});
});

describe("invocation checks", () => {
	test("is satisfied when the running interpreter would be reused", async () => {
		let spawned = 0;
		const report = await probeExtension(
			"subagent",
			seams({
				invocation: () => ({ command: process.execPath, args: ["pi.js", "--version"] }),
				exec: async () => {
					spawned += 1;
					return { code: 0 };
				},
			}),
		);
		expect(find(report, process.execPath)?.severity).toBe("ok");
		expect(spawned).toBe(0);
	});

	test("reports an unrunnable pi binary as missing", async () => {
		const report = await probeExtension("subagent", seams({ exec: async () => ({ code: 127 }) }));
		const finding = find(report, "pi");
		expect(finding?.severity).toBe("missing");
		expect(finding?.detail).toContain("cannot be run");
	});
});

describe("the report shape", () => {
	test("reports a disabled extension without probing it", async () => {
		let spawned = 0;
		const report = await probeExtension(
			"document",
			seams({
				isEnabled: () => false,
				exec: async () => {
					spawned += 1;
					return { code: 0 };
				},
			}),
		);
		expect(report.enabled).toBe(false);
		expect(report.findings[0]?.detail).toContain("PI_DISABLED_EXTENSIONS");
		expect(spawned).toBe(0);
	});

	test("flags an extension with no declaration", async () => {
		const report = await probeExtension("nonexistent", seams());
		expect(report.findings[0]?.severity).toBe("info");
		expect(report.findings[0]?.detail).toContain("no prerequisites are declared");
	});

	test("carries expected platform notes as info", async () => {
		const report = await probeExtension("bytefly", seams());
		const note = report.findings.find((finding) => finding.check === "platform");
		expect(note?.severity).toBe("info");
		expect(note?.detail).toContain("TUI only");
	});

	test("names the Windows job facts, matching the runtime's refusal", async () => {
		const report = await probeExtension("job", seams());
		const notes = report.findings.filter((finding) => finding.check === "platform");
		const detail = notes.map((finding) => finding.detail).join("\n");
		// The note and the `start` error have to agree about what is and is not possible.
		expect(detail).toContain("detached: true` is refused");
		expect(detail).toContain("detachedByDefault` is inert");
		expect(detail).toContain("unknown");
	});

	test("probes every declared extension in order", async () => {
		const reports = await probeAll(seams());
		expect(reports.map((report) => report.extension)).toEqual(Object.keys(REQUIREMENTS));
	});

	test("runs probes a few at a time, preserving declaration order", async () => {
		let inFlight = 0;
		let peak = 0;
		const names = ["worktree", "rewind", "subagent", "plan", "job", "todo"];
		const reports = await probeAll(
			seams({
				exec: async () => {
					inFlight += 1;
					peak = Math.max(peak, inFlight);
					await Promise.resolve();
					inFlight -= 1;
					return { code: 0 };
				},
			}),
			names,
		);

		expect(reports.map((report) => report.extension)).toEqual(names);
		// Not serial (the sum of every probe), and never a burst of the whole table.
		expect(peak).toBeGreaterThan(1);
		expect(peak).toBeLessThanOrEqual(PROBE_CONCURRENCY);
	});

	test("missingFindings keeps only enabled extensions' hard failures", async () => {
		const reports = await probeAll(seams({ exec: async () => ({ code: 1 }) }));
		const names = new Set(missingFindings(reports).map((finding) => finding.extension));
		expect(names.has("rewind")).toBe(true);
		// `plan` needs git only for project-local plans, so it stays out of the warning set.
		expect(names.has("plan")).toBe(false);
	});

	test("hardRequirementExtensions lists exactly the extensions that can warn at session start", () => {
		expect(hardRequirementExtensions().sort()).toEqual(["rewind", "subagent", "worktree"]);
	});
});

describe("canDeliver", () => {
	const tty = { platform: "linux" as const, isTTY: true };

	test("auto always delivers, because it reads the environment itself", () => {
		expect(canDeliver("auto", { platform: "linux", isTTY: false })).toBe(true);
		expect(canDeliver("auto", { platform: "win32", isTTY: false })).toBe(true);
	});

	test("the OSC methods need a terminal to write to", () => {
		expect(canDeliver("osc777", tty)).toBe(true);
		expect(canDeliver("osc99", tty)).toBe(true);
		expect(canDeliver("osc777", { platform: "darwin", isTTY: false })).toBe(false);
		expect(canDeliver("osc99", { platform: "darwin", isTTY: false })).toBe(false);
	});

	test("the platform notifiers only deliver on their platform", () => {
		expect(canDeliver("toast", { platform: "win32", isTTY: true })).toBe(true);
		expect(canDeliver("toast", tty)).toBe(false);
		expect(canDeliver("osascript", { platform: "darwin", isTTY: true })).toBe(true);
		expect(canDeliver("osascript", tty)).toBe(false);
		expect(canDeliver("notify-send", tty)).toBe(true);
		expect(canDeliver("notify-send", { platform: "darwin", isTTY: true })).toBe(false);
	});

	test("leaves an unknown method to the loader that rejected it", () => {
		expect(canDeliver("carrier-pigeon", tty)).toBe(true);
	});
});

describe("the notify check", () => {
	/** A notify seam answering the given configuration. */
	const notify = (config: { enabled: boolean; method: string }) => () => config;

	test("is ok while notifications are off, whatever the method", async () => {
		const report = await probeExtension("bytefly", seams({ notify: notify({ enabled: false, method: "toast" }) }));
		expect(find(report, "notify.method")?.severity).toBe("ok");
		expect(find(report, "notify.method")?.detail).toContain("notifications are off");
	});

	test("is ok when the configured method suits this host", async () => {
		const report = await probeExtension("bytefly", seams({ notify: notify({ enabled: true, method: "osascript" }) }));
		expect(find(report, "notify.method")?.severity).toBe("ok");
		expect(find(report, "notify.method")?.detail).toBe('"osascript" delivers on darwin');
	});

	test("is ok for auto and says what auto does", async () => {
		const report = await probeExtension("bytefly", seams({ notify: notify({ enabled: true, method: "auto" }) }));
		expect(find(report, "notify.method")?.severity).toBe("ok");
		expect(find(report, "notify.method")?.detail).toContain("auto picks a route from the environment");
	});

	test("degrades to one named finding when the method cannot deliver", async () => {
		const report = await probeExtension("bytefly", seams({ notify: notify({ enabled: true, method: "notify-send" }) }));
		const finding = find(report, "notify.method");
		expect(finding?.severity).toBe("degraded");
		expect(finding?.detail).toContain('"notify-send" cannot deliver on darwin');
		expect(finding?.hint).toContain('"notify.method"');
	});

	test("degrades an OSC method with no terminal behind it", async () => {
		const report = await probeExtension(
			"bytefly",
			seams({ notify: notify({ enabled: true, method: "osc777" }), isTTY: false }),
		);
		expect(find(report, "notify.method")?.severity).toBe("degraded");
	});

	test("reports ok when the capability is absent, so the check never invents a problem", async () => {
		const report = await probeExtension("bytefly", seams());
		expect(find(report, "notify.method")?.severity).toBe("ok");
	});
});

describe("the provider check", () => {
	/** The facts `web-access` publishes for one session. */
	function facts(over: Partial<WebSearchProviderEvent> = {}): WebSearchProviderEvent {
		return {
			provider: "duckduckgo",
			reason: "default",
			configured: true,
			endpoint: null,
			apiKeyEnv: null,
			keyConfigured: false,
			...over,
		};
	}

	test("names the resolved provider", async () => {
		const report = await probeExtension("web-access", seams({ searchProvider: () => facts() }));
		expect(find(report, "web-access.search.provider")).toEqual({
			extension: "web-access",
			check: "web-access.search.provider",
			severity: "ok",
			detail: "resolved to duckduckgo (default)",
		});
	});

	test("warns when an explicit provider is not configured", async () => {
		const report = await probeExtension(
			"web-access",
			seams({ searchProvider: () => facts({ provider: "searxng", reason: "explicit", configured: false }) }),
		);
		const finding = find(report, "web-access.search.provider");
		expect(finding?.severity).toBe("degraded");
		expect(finding?.detail).toContain("resolved to searxng (explicit), which is not configured");
		expect(finding?.hint).toContain("web-access.search.provider");
	});

	test("names the key variable that is missing, without a key value", async () => {
		const report = await probeExtension(
			"web-access",
			seams({
				searchProvider: () => facts({ provider: "brave", apiKeyEnv: "BRAVE_SEARCH_API_KEY" }),
				env: () => undefined,
			}),
		);
		const finding = find(report, "BRAVE_SEARCH_API_KEY");
		expect(finding?.severity).toBe("degraded");
		expect(finding?.detail).toBe("the API key for brave is missing — BRAVE_SEARCH_API_KEY is not set");
		expect(finding?.hint).toContain("export BRAVE_SEARCH_API_KEY");
	});

	test("reports the variable as set when it is", async () => {
		const report = await probeExtension(
			"web-access",
			seams({
				searchProvider: () => facts({ provider: "brave", apiKeyEnv: "BRAVE_SEARCH_API_KEY" }),
				env: () => "k",
			}),
		);
		expect(find(report, "BRAVE_SEARCH_API_KEY")?.severity).toBe("ok");
	});

	test("a literal key needs no variable", async () => {
		const report = await probeExtension(
			"web-access",
			seams({
				searchProvider: () => facts({ provider: "brave", apiKeyEnv: "BRAVE_SEARCH_API_KEY", keyConfigured: true }),
				env: () => undefined,
			}),
		);
		expect(report.findings.some((finding) => finding.check === "BRAVE_SEARCH_API_KEY")).toBe(false);
	});

	test("probes the endpoint only on an explicit refresh", async () => {
		let probed = 0;
		const reach = async () => {
			probed += 1;
			return { ok: true };
		};
		const withEndpoint = () => facts({ provider: "searxng", endpoint: "http://searx.local:8080" });

		const cheap = await probeExtension("web-access", seams({ searchProvider: withEndpoint, reach }));
		expect(probed).toBe(0);
		expect(cheap.findings.some((finding) => finding.check === "http://searx.local:8080")).toBe(false);

		const refreshed = await probeExtension("web-access", seams({ searchProvider: withEndpoint, reach, refresh: true }));
		expect(probed).toBe(1);
		expect(find(refreshed, "http://searx.local:8080")?.severity).toBe("ok");
	});

	test("reports an endpoint that does not answer", async () => {
		const report = await probeExtension(
			"web-access",
			seams({
				searchProvider: () => facts({ provider: "searxng", endpoint: "http://searx.local:8080" }),
				reach: async () => ({ ok: false, error: "connect ECONNREFUSED" }),
				refresh: true,
			}),
		);
		const finding = find(report, "http://searx.local:8080");
		expect(finding?.severity).toBe("degraded");
		expect(finding?.detail).toBe("http://searx.local:8080 did not answer (connect ECONNREFUSED)");
		expect(finding?.hint).toContain("web-access.search.endpoint");
	});

	test("stays informational when no provider was published", async () => {
		const report = await probeExtension("web-access", seams());
		const finding = find(report, "web-access.search.provider");
		expect(finding?.severity).toBe("info");
		expect(finding?.detail).toContain("has not reported");
	});

	test("never puts a key value in a detail", async () => {
		const report = await probeExtension(
			"web-access",
			seams({
				searchProvider: () => facts({ provider: "brave", apiKeyEnv: "BRAVE_SEARCH_API_KEY", keyConfigured: true }),
				env: () => "super-secret",
			}),
		);
		expect(JSON.stringify(report.findings)).not.toContain("super-secret");
	});
});

describe("safety checks", () => {
	/** Seams whose config read answers per path, with everything else satisfied. */
	function configSeams(documents: Record<string, unknown>): ProbeSeams {
		return seams({
			readJson: (path: string) => {
				const document = documents[path];
				return document === undefined
					? { state: "absent" as const }
					: { state: "ok" as const, value: document as Record<string, unknown> };
			},
		});
	}

	/** A `bytefly.json` document with the worktree powershell switch set. */
	const withSwitch = (value: unknown): Record<string, unknown> => ({
		worktree: { guard: { blockPowershell: value } },
	});

	test("passes when nothing configures the switch", async () => {
		const report = await probeExtension("worktree", configSeams({}));
		const finding = find(report, "worktree.guard.blockPowershell");
		expect(finding?.severity).toBe("ok");
		expect(finding?.detail).toBe("`powershell` is refused while the session is isolated");
		expect(finding?.hint).toBeUndefined();
	});

	test("passes when the switch is on, in either scope", async () => {
		for (const documents of [
			{ [agentPath("bytefly.json")]: withSwitch(true) },
			{ [projectPath("bytefly.json")]: withSwitch(true) },
		]) {
			const report = await probeExtension("worktree", configSeams(documents));
			expect(find(report, "worktree.guard.blockPowershell")?.severity).toBe("ok");
		}
	});

	test("warns when a document turns the refusal off", async () => {
		const report = await probeExtension("worktree", configSeams({ [agentPath("bytefly.json")]: withSwitch(false) }));
		const finding = find(report, "worktree.guard.blockPowershell");
		expect(finding?.severity).toBe("degraded");
		expect(finding?.detail).toBe(
			`is false in ${agentPath("bytefly.json")} — ` +
				"`powershell` runs unguarded, with its relative paths against the main checkout",
		);
		expect(finding?.hint).toContain("worktree.guard.blockPowershell");
	});

	test("lets the project scope win over the global one, in both directions", async () => {
		const offGlobally = await probeExtension(
			"worktree",
			configSeams({ [agentPath("bytefly.json")]: withSwitch(false), [projectPath("bytefly.json")]: withSwitch(true) }),
		);
		expect(find(offGlobally, "worktree.guard.blockPowershell")?.severity).toBe("ok");

		const offInProject = await probeExtension(
			"worktree",
			configSeams({ [agentPath("bytefly.json")]: withSwitch(true), [projectPath("bytefly.json")]: withSwitch(false) }),
		);
		expect(find(offInProject, "worktree.guard.blockPowershell")?.severity).toBe("degraded");
	});

	test("a document without the section says nothing either way", async () => {
		const report = await probeExtension("worktree", configSeams({ [projectPath("bytefly.json")]: { price: {} } }));
		expect(find(report, "worktree.guard.blockPowershell")?.severity).toBe("ok");
	});

	test("does not guess when a document is unreadable", async () => {
		// The safe verdict: a broken file is not evidence that the switch is off, and
		// `bytefly doctor` reports the file itself (it is the extension that declares
		// `bytefly.json` as a config file, so the malformed-JSON finding is its own).
		const report = await probeExtension(
			"worktree",
			seams({
				readJson: (path: string) =>
					path === agentPath("bytefly.json") ? { state: "error", error: "Unexpected token" } : { state: "absent" },
			}),
		);
		expect(find(report, "worktree.guard.blockPowershell")?.severity).toBe("ok");
		expect(report.findings.filter((finding) => finding.severity === "degraded")).toEqual([]);
	});
});

describe("ageInDays", () => {
	const now = Date.parse("2026-10-19T12:00:00Z");

	test("counts whole days since a date", () => {
		expect(ageInDays("2026-10-19", now)).toBe(0);
		expect(ageInDays("2026-10-18", now)).toBe(1);
		expect(ageInDays("2026-07-21", now)).toBe(90);
	});

	test("rejects anything that is not a real calendar date", () => {
		for (const bad of ["", "19/10/2026", "2026-1-9", "2026-02-31", "2026-13-01", "not a date"]) {
			expect(ageInDays(bad, now), bad).toBeUndefined();
		}
	});

	test("reads a day of clock skew as fresh, and anything further ahead as a typo", () => {
		// A record made in a timezone ahead of UTC is not a mistake.
		expect(ageInDays("2026-10-20", now)).toBe(0);
		expect(ageInDays("2026-10-21", now)).toBeUndefined();
	});
});

describe("age checks", () => {
	/** 2026-10-19 is the recorded date; the clock below is set relative to it. */
	const VERIFIED = "2026-10-19";
	const at = (iso: string): number => Date.parse(iso + "T00:00:00Z");

	/** The age finding bytefly's declaration produces at that clock. */
	async function ageFinding(date: string | undefined, clock: string) {
		const report = await probeExtension(
			"bytefly",
			seams({ priceVerifiedAt: () => date, now: () => at(clock), readJson: () => ({ state: "absent" }) }),
		);
		return find(report, "the built-in DeepSeek rate tables");
	}

	test("passes a recent record and names its age", async () => {
		const finding = await ageFinding(VERIFIED, "2026-10-22");
		expect(finding?.severity).toBe("ok");
		expect(finding?.detail).toBe("the built-in DeepSeek rate tables last checked 3 days ago");
	});

	test("still passes at the window's edge", async () => {
		// 90 days on from 2026-10-19.
		expect((await ageFinding(VERIFIED, "2027-01-17"))?.severity).toBe("ok");
	});

	test("warns once the record is stale, with the re-check hint", async () => {
		const finding = await ageFinding(VERIFIED, "2027-01-18");
		expect(finding?.severity).toBe("degraded");
		expect(finding?.detail).toContain("beyond the 90-day window");
		expect(finding?.hint).toContain("api-docs.deepseek.com");
	});

	test("says so when no date is recorded or it does not parse", async () => {
		for (const date of [undefined, "someday"]) {
			const finding = await ageFinding(date, "2026-10-22");
			expect(finding?.severity).toBe("info");
			expect(finding?.detail).toContain("no verification date");
		}
	});
});

// --- The default browser ----------------------------------------------------

describe("browserCommand", () => {
	test("uses start on Windows, open on macOS, and xdg-open elsewhere", () => {
		expect(browserCommand("http://x/", "win32")).toEqual({ command: "cmd", args: ["/c", "start", "", "http://x/"] });
		expect(browserCommand("http://x/", "darwin")).toEqual({ command: "open", args: ["http://x/"] });
		expect(browserCommand("http://x/", "linux")).toEqual({ command: "xdg-open", args: ["http://x/"] });
	});
});

describe("openInBrowser", () => {
	test("spawns the platform command with the URL", () => {
		const calls: Array<[string, string[]]> = [];
		openInBrowser("http://x/", {
			platform: "linux",
			spawn: (command, args) => calls.push([command, args]),
		});
		expect(calls).toEqual([["xdg-open", ["http://x/"]]]);
	});

	test("ignores spawn failures, because the URL is printed too", () => {
		expect(() =>
			openInBrowser("http://x/", {
				platform: "win32",
				spawn: () => {
					throw new Error("no browser");
				},
			}),
		).not.toThrow();
	});
});

// --- The PDF seam -----------------------------------------------------------

describe("pdfTextFromResult", () => {
	test("reads the text field of a merged result", () => {
		expect(pdfTextFromResult({ totalPages: 2, text: "body" })).toBe("body");
	});

	test("accepts a bare string", () => {
		expect(pdfTextFromResult("body")).toBe("body");
	});

	test("returns an empty string for anything else", () => {
		expect(pdfTextFromResult(undefined)).toBe("");
		expect(pdfTextFromResult({})).toBe("");
		expect(pdfTextFromResult({ text: 42 })).toBe("");
	});
});

describe("pdfExtractorFromModule", () => {
	test("calls a named extractText with merged pages", async () => {
		let seen: { size: number; options: unknown } | undefined;
		const extractor = pdfExtractorFromModule({
			extractText: async (bytes: Uint8Array, options: unknown) => {
				seen = { size: bytes.length, options };
				return { totalPages: 1, text: "body" };
			},
		});

		expect(await extractor(new Uint8Array([1, 2]))).toBe("body");
		expect(seen).toEqual({ size: 2, options: { mergePages: true } });
	});

	test("falls back to the default export's extractText", async () => {
		const extractor = pdfExtractorFromModule({
			default: { extractText: async () => "wrapped" },
		});
		expect(await extractor(new Uint8Array())).toBe("wrapped");
	});

	test("rejects a module without extractText", () => {
		for (const module of [{}, { extractText: "not a function" }, null, { default: {} }]) {
			expect(() => pdfExtractorFromModule(module), JSON.stringify(module)).toThrow(PdfUnavailableError);
		}
	});

	test("names the install command when the package is missing", () => {
		expect(pdfGuidance()).toContain("npm i unpdf");
	});
});

describe("extractPdfText", () => {
	test("uses an injected extractor instead of loading unpdf", async () => {
		const text = await extractPdfText(new Uint8Array([1]), async (bytes) => `injected ${bytes.length}`);
		expect(text).toBe("injected 1");
	});
});

// --- The nested pi invocation -----------------------------------------------

describe("getPiInvocation", () => {
	/** A path that exists, standing in for Pi's own entry script. */
	const SCRIPT = join(import.meta.dir, "requirements.test.ts");

	/** Process facts, defaulting to a plain Node run of the entry script. */
	function runtime(overrides: Partial<PiRuntime> = {}): PiRuntime {
		return { execPath: "/usr/local/bin/node", entryScript: SCRIPT, ...overrides };
	}

	test("reuses the interpreter and the entry script it was started with", () => {
		expect(getPiInvocation(["--version"], runtime())).toEqual({
			command: "/usr/local/bin/node",
			args: [SCRIPT, "--version"],
		});
	});

	test("falls back to pi on PATH when the runtime was given no script", () => {
		expect(getPiInvocation(["--version"], runtime({ entryScript: undefined }))).toEqual({
			command: "pi",
			args: ["--version"],
		});
	});

	test("skips a script path that does not exist", () => {
		expect(getPiInvocation([], runtime({ entryScript: join(import.meta.dir, "no-such-file.ts") }))).toEqual({
			command: "pi",
			args: [],
		});
	});

	test("skips a bundled Bun script, which no other process can run", () => {
		const bundled = runtime({ execPath: "/usr/local/bin/bun", entryScript: "/$bunfs/root/pi" });
		expect(getPiInvocation([], bundled)).toEqual({ command: "pi", args: [] });
	});

	test("re-executes a standalone pi instead of reading a user argument as a script", () => {
		const standalone = runtime({ execPath: "/usr/local/bin/pi", entryScript: "notes.md" });
		expect(getPiInvocation(["notes.md"], standalone)).toEqual({
			command: "/usr/local/bin/pi",
			args: ["notes.md"],
		});
	});

	test("treats a compiled Bun build as standalone whatever the binary is called", () => {
		const compiled = runtime({ execPath: "/opt/homebrew/bin/my-pi", entryScript: undefined, bunVersion: "1.4.3" });
		expect(getPiInvocation([], compiled)).toEqual({ command: "/opt/homebrew/bin/my-pi", args: [] });
	});

	test("still reuses the script for an interpreter under another name", () => {
		expect(getPiInvocation([], runtime({ execPath: "/usr/bin/nodejs" }))).toEqual({
			command: "/usr/bin/nodejs",
			args: [SCRIPT],
		});
	});
});
