import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	cliGuidance,
	hardRequirementExtensions,
	missingFindings,
	pdfGuidance,
	probeAll,
	probeExtension,
	renderGuidance,
	REQUIREMENTS,
	type ProbeSeams,
} from "./requirements.ts";

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
		loadModule: async () => ({ chromium: { executablePath: () => process.execPath } }),
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

	test("reports a missing binary with its install hint", async () => {
		const report = await probeExtension("document", seams({ exec: async () => ({ code: 1 }) }));
		const finding = find(report, "pdfcraft-cli");
		expect(finding?.severity).toBe("missing");
		expect(finding?.detail).toContain("not found on PATH");
		expect(finding?.hint).toContain("cargo install --git https://github.com/storytold/pdfcraft");
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

	test("reports playwright without a browser as incomplete", async () => {
		const report = await probeExtension(
			"web-access",
			seams({ loadModule: async () => ({ chromium: { executablePath: () => "/nope/chrome" } }) }),
		);
		const finding = find(report, "playwright");
		expect(finding?.severity).toBe("degraded");
		expect(finding?.detail).toContain("installed but incomplete");
		expect(finding?.hint).toContain("npx playwright install chromium");
	});

	test("accepts an installed package with a browser", async () => {
		const report = await probeExtension(
			"web-access",
			seams({ loadModule: async () => ({ chromium: { executablePath: () => process.execPath } }) }),
		);
		expect(find(report, "playwright")?.severity).toBe("ok");
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
		const report = await probeExtension("document", seams());
		expect(report.findings.some((finding) => finding.check.endsWith(".json"))).toBe(false);
	});

	test("names a malformed project config and the parse error", async () => {
		const report = await probeExtension(
			"document",
			seams({
				readJson: (path) =>
					path === projectPath("document.json")
						? { state: "error", error: "Unexpected token 'n'" }
						: { state: "absent" },
			}),
		);
		const finding = find(report, projectPath("document.json"));
		expect(finding?.severity).toBe("degraded");
		expect(finding?.detail).toContain("not valid JSON");
		expect(finding?.detail).toContain("Unexpected token");
	});

	test("distinguishes the global and project scopes", async () => {
		const report = await probeExtension(
			"todo",
			seams({
				readJson: (path) =>
					path === agentPath("todo.json") ? { state: "error", error: "bad json" } : { state: "absent" },
			}),
		);
		const finding = find(report, agentPath("todo.json"));
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
		const report = await probeExtension("status-bar", seams());
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
		expect(names.has("document")).toBe(true);
		expect(names.has("rewind")).toBe(true);
		// `plan` needs git only for project-local plans, so it stays out of the warning set.
		expect(names.has("plan")).toBe(false);
	});
});

describe("install guidance", () => {
	test("names the package install for the optional peers", () => {
		expect(pdfGuidance()).toContain("npm i unpdf");
		expect(renderGuidance()).toContain("npx playwright install chromium");
	});

	test("names the cargo command for an extractor CLI", () => {
		expect(cliGuidance("gridcraft-cli")).toContain(
			"cargo install --git https://github.com/storytold/gridcraft gridcraft-cli",
		);
	});
});

describe("hard requirement extensions", () => {
	test("lists exactly the extensions that can warn at session start", () => {
		expect(hardRequirementExtensions().sort()).toEqual(["document", "rewind", "subagent", "worktree"]);
	});
});
