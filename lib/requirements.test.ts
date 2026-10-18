import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	canDeliver,
	hardRequirementExtensions,
	missingFindings,
	pdfGuidance,
	probeAll,
	probeExtension,
	REQUIREMENTS,
	type ProbeSeams,
} from "./requirements.ts";
import type { WebSearchProviderEvent } from "./events.ts";

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
function find(report: Awaited<ReturnType<typeof probeExtension>>, check: string) {
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

describe("config checks", () => {
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
		const finding = find(report, agentPath("bytefly.json"));
		expect(finding?.detail).toContain("the global config is ignored");
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

describe("report shape", () => {
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

	test("probes every declared extension in order", async () => {
		const reports = await probeAll(seams());
		expect(reports.map((report) => report.extension)).toEqual(Object.keys(REQUIREMENTS));
	});

	test("missingFindings keeps only enabled extensions' hard failures", async () => {
		const reports = await probeAll(seams({ exec: async () => ({ code: 1 }) }));
		const names = new Set(missingFindings(reports).map((finding) => finding.extension));
		expect(names.has("rewind")).toBe(true);
		// `plan` needs git only for project-local plans, so it stays out of the warning set.
		expect(names.has("plan")).toBe(false);
	});
});

describe("install guidance", () => {
	test("names the package install for the optional peer", () => {
		expect(pdfGuidance()).toContain("npm i unpdf");
	});
});

describe("hard requirement extensions", () => {
	test("lists exactly the extensions that can warn at session start", () => {
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

describe("provider check", () => {
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
