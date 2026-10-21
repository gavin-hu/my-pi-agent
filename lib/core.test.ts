/**
 * The shared core: config coercion and the `bytefly.json` document, the worktree
 * environment, boundary errors and HTML escaping, path containment, the
 * read-only policy, the rejected-call shape, the transcript notice, and the
 * turn-affinity prompt channel.
 *
 * Every case runs over a temp directory or an injected seam; no session, host,
 * or network is involved.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { CONFIG_DIR_NAME, type ToolAnnotations } from "@earendil-works/pi-coding-agent";
import { tempDir, useEnv, withAgentDir, withEnv } from "../test/helpers/env.ts";
import { makeTempTracker } from "../test/helpers/git.ts";
import { canCreateSymlinks } from "../test/helpers/platform.ts";
import {
	asBoolean,
	asRecord,
	clampInteger,
	clampNumber,
	cleanString,
	configSection,
	configValueAt,
	loadConfigFile,
	loadConfigSection,
	optionalString,
	readJson,
	readJsonResult,
	SHARED_CONFIG_FILE,
	stringList,
	unsetConfigValueAt,
	writeConfigFile,
	writeConfigSection,
	writeConfigValue,
	writeConfigValueAt,
	writeConfigValuesAt,
} from "./config.ts";
import {
	ENV_DISABLED_EXTENSIONS,
	ENV_OFFLINE,
	ENV_ROOT,
	isExtensionEnabled,
	isOffline,
	resolveEffectiveCwd,
	worktreeRoot,
} from "./env.ts";
import { messageOf } from "./errors.ts";
import { escapeHtml } from "./escape.ts";
import {
	askHuman,
	INTERACTION_TURN_KEY,
	type InteractionChannel,
	type InteractionMode,
	isRemoteTurn,
	remoteChannel,
	supportsCustomUI,
	type UIContextCarrier,
} from "./interaction.ts";
import { isNotice, NOTICE_TYPE, noticeMessage, pruneStaleNotices } from "./notice.ts";
import { isInside, isInsideReal, realPathOfNearest } from "./path.ts";
import { createReadOnlyPolicy } from "./policy.ts";
import { errorResult, toolError } from "./tool-result.ts";

const temps = makeTempTracker();
const env = useEnv({ [ENV_ROOT]: undefined, [ENV_DISABLED_EXTENSIONS]: undefined, [ENV_OFFLINE]: undefined });

afterAll(() => {
	env.restore();
	temps.flush();
});

/** A temp directory, removed at teardown. */
function scratch(prefix: string): string {
	return temps.track(tempDir(prefix));
}

/** A temp file holding `contents`, removed at teardown. */
function wrote(prefix: string, contents: string): string {
	const path = join(scratch(prefix), SHARED_CONFIG_FILE);
	writeFileSync(path, contents);
	return path;
}

/** A file the suite may write, without creating it. */
function documentPath(prefix: string): string {
	return join(scratch(prefix), SHARED_CONFIG_FILE);
}

// --- Config coercion --------------------------------------------------------

describe("clampInteger", () => {
	test("rounds a number into the inclusive range", () => {
		const cases: Array<[unknown, number]> = [
			[1500.4, 1500],
			[1500.5, 1501],
			[5, 100],
			[2500, 2000],
			["2500", 2000],
			[" 250 ", 250],
		];
		for (const [value, expected] of cases) {
			expect(clampInteger(value, 1000, 100, 2000), String(value)).toBe(expected);
		}
	});

	test("treats a value that does not state a number as unset", () => {
		for (const value of [undefined, null, "   ", "abc", true, [], NaN, Number.POSITIVE_INFINITY]) {
			expect(clampInteger(value, 1000, 100, 2000), String(value)).toBe(1000);
		}
	});
});

describe("clampNumber", () => {
	test("clamps into range without rounding", () => {
		expect(clampNumber(12.5, 0, 0, 100)).toBe(12.5);
		expect(clampNumber(0.006, 0, 0, 100)).toBe(0.006);
		expect(clampNumber(150.25, 0, 0, 100)).toBe(100);
		expect(clampNumber(-1, 0, 0, 100)).toBe(0);
		expect(clampNumber("2.5", 0, 0, 100)).toBe(2.5);
	});

	test("falls back for a value that does not state a number", () => {
		for (const value of ["abc", undefined, null, true, NaN]) {
			expect(clampNumber(value, 7, 0, 100), String(value)).toBe(7);
		}
	});
});

describe("string config values", () => {
	test("trim a value and fall back when it is not a string", () => {
		expect(cleanString("  hi  ", "fb")).toBe("hi");
		expect(cleanString("   ", "fb")).toBe("fb");
		expect(cleanString(7, "fb")).toBe("fb");
	});

	test("are undefined when blank, so an absent setting stays absent", () => {
		expect(optionalString("  hi  ")).toBe("hi");
		expect(optionalString("   ")).toBeUndefined();
		expect(optionalString(undefined)).toBeUndefined();
		expect(optionalString(7)).toBeUndefined();
	});
});

describe("config value narrowing", () => {
	test("keeps a boolean and falls back for anything else", () => {
		expect(asBoolean(true, false)).toBe(true);
		expect(asBoolean(false, true)).toBe(false);
		expect(asBoolean("true", true)).toBe(true);
		expect(asBoolean(0, false)).toBe(false);
		expect(asBoolean(undefined, true)).toBe(true);
	});

	test("reads an array of strings trimmed, dropping the rest", () => {
		expect(stringList([" a ", "", "  ", 3, "b"], [])).toEqual(["a", "b"]);
	});

	test("returns the caller's own list when the value is not an array", () => {
		const fallback = ["kept"];
		expect(stringList(undefined, fallback)).toBe(fallback);
		expect(stringList("x", fallback)).toBe(fallback);
	});

	test("narrows a plain object and refuses every other JSON shape", () => {
		expect(asRecord({ a: 1 })).toEqual({ a: 1 });
		expect(asRecord({})).toEqual({});
		for (const value of [[1, 2], null, "x", 7, undefined]) {
			expect(asRecord(value), String(value)).toBeUndefined();
		}
	});
});

// --- Config reads -----------------------------------------------------------

describe("readJsonResult", () => {
	test("reports a missing file as absent, not as an error", () => {
		expect(readJsonResult(join(scratch("pi-config-"), "nope.json"))).toEqual({ state: "absent" });
	});

	test("returns the parsed object", () => {
		expect(readJsonResult(wrote("pi-config-", '{"mode":"auto"}'))).toEqual({
			state: "ok",
			value: { mode: "auto" },
		});
	});

	test("names the parse error instead of swallowing it", () => {
		const result = readJsonResult(wrote("pi-config-", "{ not json"));
		expect(result.state).toBe("error");
		if (result.state === "error") expect(result.error.length).toBeGreaterThan(0);
	});

	test("rejects a non-object document", () => {
		expect(readJsonResult(wrote("pi-config-", "[1,2,3]"))).toEqual({
			state: "error",
			error: "expected a JSON object at the top level",
		});
	});

	test("reports an unreadable path as an error", () => {
		const dir = scratch("pi-config-");
		mkdirSync(join(dir, "sub"));
		expect(readJsonResult(join(dir, "sub")).state).toBe("error");
	});
});

describe("readJson", () => {
	test("stays lenient: the value or undefined, never a throw", () => {
		expect(readJson(wrote("pi-config-", '{"mode":"always"}'))).toEqual({ mode: "always" });
		expect(readJson(wrote("pi-config-", "{ not json"))).toBeUndefined();
		expect(readJson(wrote("pi-config-", "[]"))).toBeUndefined();
		expect(readJson(join(scratch("pi-config-"), "nope.json"))).toBeUndefined();
	});
});

describe("config loading", () => {
	const normalize = (raw: Record<string, unknown> | undefined, base: { size: number; mode: string }) => ({
		size: clampInteger(raw?.size, base.size, 100, 10_000),
		mode: cleanString(raw?.mode, base.mode),
	});
	const base = { size: 1000, mode: "base" };

	/** A project config directory under `cwd`, holding `contents`. */
	function projectConfig(cwd: string, contents: string): void {
		mkdirSync(join(cwd, CONFIG_DIR_NAME), { recursive: true });
		writeFileSync(join(cwd, CONFIG_DIR_NAME, SHARED_CONFIG_FILE), contents);
	}

	test("loadConfigFile layers the base, then the global file, then the project file", async () => {
		await withAgentDir(async (agentDir) => {
			const cwd = scratch("pi-config-cwd-");
			writeFileSync(join(agentDir, SHARED_CONFIG_FILE), '{"size":2000,"mode":"global"}');
			projectConfig(cwd, '{"mode":"project"}');

			expect(loadConfigFile(cwd, SHARED_CONFIG_FILE, base, normalize)).toEqual({ size: 2000, mode: "project" });
		});
	});

	test("ignores a malformed file and keeps the value already in hand", async () => {
		await withAgentDir(async (agentDir) => {
			const cwd = scratch("pi-config-cwd-");
			writeFileSync(join(agentDir, SHARED_CONFIG_FILE), "{ not json");
			projectConfig(cwd, "{ still not json");

			expect(loadConfigFile(cwd, SHARED_CONFIG_FILE, base, normalize)).toEqual(base);
		});
	});

	test("loadConfigSection layers the global section, then the project section", async () => {
		await withAgentDir(async (agentDir) => {
			const cwd = scratch("pi-config-section-");
			writeFileSync(join(agentDir, SHARED_CONFIG_FILE), '{"thing":{"size":2000,"mode":"global"}}');
			projectConfig(cwd, '{"thing":{"mode":"project"}}');

			expect(loadConfigSection(cwd, "thing", base, normalize)).toEqual({ size: 2000, mode: "project" });
		});
	});

	test("loadConfigSection reads a section from an explicit agent directory", () => {
		const agentDir = scratch("pi-config-agent-");
		const cwd = scratch("pi-config-cwd-");
		writeFileSync(join(agentDir, SHARED_CONFIG_FILE), '{"thing":{"size":3000}}');

		expect(loadConfigSection(cwd, "thing", base, normalize, { agentDir })).toEqual({ size: 3000, mode: "base" });
	});

	test("configSection returns an object, and nothing for any other shape", () => {
		expect(configSection({ job: { a: 1 } }, "job")).toEqual({ a: 1 });
		expect(configSection({ job: [1] }, "job")).toBeUndefined();
		expect(configSection(undefined, "job")).toBeUndefined();
		expect(configSection({}, "job")).toBeUndefined();
	});

	test("configValueAt reads a top-level key and a nested path", () => {
		const document = { price: { currency: { decimals: 3 } }, chrome: { rail: "│" } };
		expect(configValueAt(document, ["chrome", "rail"])).toBe("│");
		expect(configValueAt(document, ["price", "currency", "decimals"])).toBe(3);
	});

	test("configValueAt stops at a step that is absent or not an object", () => {
		const document = { price: { currency: "yuan" } };
		expect(configValueAt(document, ["price", "currency", "decimals"])).toBeUndefined();
		expect(configValueAt(document, ["notify", "enabled"])).toBeUndefined();
		expect(configValueAt(undefined, ["price"])).toBeUndefined();
	});
});

// --- Config writes ----------------------------------------------------------

describe("writeConfigSection", () => {
	test("writes a new document with two-space JSON and a trailing newline", () => {
		const path = join(scratch("pi-config-write-"), "nested", SHARED_CONFIG_FILE);
		writeConfigSection(path, "job", { maxJobs: 5 });

		expect(readJson(path)).toEqual({ job: { maxJobs: 5 } });
		expect(readFileSync(path, "utf-8")).toBe('{\n  "job": {\n    "maxJobs": 5\n  }\n}\n');
	});

	test("merges a section and preserves siblings and metadata", () => {
		const path = documentPath("pi-config-write-");
		writeConfigFile(path, { version: 1, job: { a: 1 }, memory: { inject: true } });
		writeConfigSection(path, "job", { b: 2 });
		expect(readJson(path)).toEqual({ version: 1, job: { b: 2 }, memory: { inject: true } });
	});
});

describe("writeConfigValue", () => {
	test("creates a missing file and section, leaving no temp file behind", () => {
		const dir = scratch("pi-config-value-");
		const path = join(dir, "nested", SHARED_CONFIG_FILE);

		writeConfigValue(path, "notify", "enabled", true);

		expect(readJson(path)).toEqual({ notify: { enabled: true } });
		expect(readFileSync(path, "utf-8").endsWith("\n")).toBe(true);
		expect(readdirSync(join(dir, "nested"))).toEqual([SHARED_CONFIG_FILE]);
	});

	test("sets one key while preserving siblings, metadata, and unknown sections", () => {
		const path = documentPath("pi-config-value-");
		writeConfigFile(path, {
			$schema: "https://example.test/meta.json",
			version: 1,
			notify: { enabled: false, title: "Pi" },
			memory: { inject: true },
		});

		writeConfigValue(path, "notify", "enabled", true);

		expect(readJson(path)).toEqual({
			$schema: "https://example.test/meta.json",
			version: 1,
			notify: { enabled: true, title: "Pi" },
			memory: { inject: true },
		});
	});

	test("refuses a malformed document without rewriting it", () => {
		const path = wrote("pi-config-value-", "{ not json");

		expect(() => writeConfigValue(path, "notify", "enabled", true)).toThrow(/Cannot update/);
		expect(readFileSync(path, "utf-8")).toBe("{ not json");
	});
});

describe("writeConfigValueAt", () => {
	test("creates the intermediate objects it needs", () => {
		const path = documentPath("pi-config-path-");
		writeConfigValueAt(path, "price", ["currency", "decimals"], 3);
		expect(readJson(path)).toEqual({ price: { currency: { decimals: 3 } } });
	});

	test("sets one leaf while preserving siblings, metadata, and unknown sections", () => {
		const path = documentPath("pi-config-path-");
		writeConfigFile(path, {
			$schema: "https://example.test/meta.json",
			version: 1,
			price: { currency: { symbol: "¥", decimals: 2 }, fallbackToRecordedCost: true },
			notify: { enabled: true },
		});

		writeConfigValueAt(path, "price", ["currency", "decimals"], 3);

		expect(readJson(path)).toEqual({
			$schema: "https://example.test/meta.json",
			version: 1,
			price: { currency: { symbol: "¥", decimals: 3 }, fallbackToRecordedCost: true },
			notify: { enabled: true },
		});
	});

	test("replaces a non-object in the way instead of refusing", () => {
		const path = documentPath("pi-config-path-");
		writeConfigFile(path, { price: { currency: "yuan" } });

		writeConfigValueAt(path, "price", ["currency", "decimals"], 3);

		expect(readJson(path)).toEqual({ price: { currency: { decimals: 3 } } });
	});

	test("refuses an empty path, and a malformed document unread", () => {
		const path = wrote("pi-config-path-", "{ not json");

		expect(() => writeConfigValueAt(path, "price", [], 3)).toThrow(/empty key path/);
		expect(() => writeConfigValueAt(path, "price", ["currency"], 3)).toThrow(/Cannot update/);
		expect(readFileSync(path, "utf-8")).toBe("{ not json");
	});
});

describe("writeConfigValuesAt", () => {
	test("sets several leaves in one document pass, keeping every sibling", () => {
		const path = documentPath("pi-config-multi-");
		writeConfigFile(path, {
			$schema: "https://example.test/meta.json",
			price: { currency: { symbol: "¥", decimals: 2 }, fallbackToRecordedCost: true },
			notify: { enabled: true },
		});

		writeConfigValuesAt(path, [
			{ section: "price", path: ["currency", "code"], value: "USD" },
			{ section: "price", path: ["currency", "decimals"], value: 3 },
		]);

		expect(readJson(path)).toEqual({
			$schema: "https://example.test/meta.json",
			price: { currency: { symbol: "¥", decimals: 3, code: "USD" }, fallbackToRecordedCost: true },
			notify: { enabled: true },
		});
	});

	test("refuses the whole change when the document cannot be parsed", () => {
		const path = wrote("pi-config-multi-", "{ not json");

		expect(() =>
			writeConfigValuesAt(path, [
				{ section: "price", path: ["currency", "code"], value: "USD" },
				{ section: "price", path: ["currency", "decimals"], value: 3 },
			]),
		).toThrow(/Cannot update/);
		expect(readFileSync(path, "utf-8")).toBe("{ not json");
	});

	test("refuses an empty path before writing anything", () => {
		const path = documentPath("pi-config-multi-");

		expect(() =>
			writeConfigValuesAt(path, [
				{ section: "price", path: ["currency", "code"], value: "USD" },
				{ section: "price", path: [], value: 3 },
			]),
		).toThrow(/empty key path/);
		expect(existsSync(path)).toBe(false);
	});
});

describe("unsetConfigValueAt", () => {
	test("removes one key and preserves its siblings and other sections", () => {
		const path = documentPath("pi-config-unset-");
		writeConfigFile(path, { notify: { enabled: true, title: "Pi" }, memory: { inject: true } });

		unsetConfigValueAt(path, "notify", ["enabled"]);

		expect(readJson(path)).toEqual({ notify: { title: "Pi" }, memory: { inject: true } });
	});

	test("removes a nested leaf and keeps its parent object", () => {
		const path = documentPath("pi-config-unset-");
		writeConfigFile(path, { price: { currency: { code: "USD", decimals: 3 }, budget: 5 } });

		unsetConfigValueAt(path, "price", ["currency", "decimals"]);

		expect(readJson(path)).toEqual({ price: { currency: { code: "USD" }, budget: 5 } });
	});

	test("drops parents left empty, the section included, and keeps metadata", () => {
		const path = documentPath("pi-config-unset-");
		writeConfigFile(path, { version: 1, price: { currency: { decimals: 3 } }, memory: { inject: true } });

		unsetConfigValueAt(path, "price", ["currency", "decimals"]);

		expect(readJson(path)).toEqual({ version: 1, memory: { inject: true } });
	});

	test("is a no-op for an absent file, section, leaf, or non-object parent", () => {
		const absent = documentPath("pi-config-unset-");
		unsetConfigValueAt(absent, "notify", ["enabled"]);
		expect(existsSync(absent)).toBe(false);

		const path = documentPath("pi-config-unset-");
		const before = `${JSON.stringify({ notify: { title: "Pi" }, price: { currency: "yuan" } }, null, 2)}\n`;
		writeFileSync(path, before);
		unsetConfigValueAt(path, "notify", ["enabled"]);
		unsetConfigValueAt(path, "missing", ["enabled"]);
		unsetConfigValueAt(path, "price", ["currency", "decimals"]);
		expect(readFileSync(path, "utf-8")).toBe(before);
	});

	test("refuses a malformed document without rewriting it", () => {
		const path = wrote("pi-config-unset-", "{ not json");

		expect(() => unsetConfigValueAt(path, "notify", ["enabled"])).toThrow(/Cannot update/);
		expect(readFileSync(path, "utf-8")).toBe("{ not json");
	});

	test("refuses an empty path", () => {
		const path = documentPath("pi-config-unset-");
		writeConfigFile(path, { notify: { enabled: true } });

		expect(() => unsetConfigValueAt(path, "notify", [])).toThrow(/empty key path/);
	});
});

// --- The worktree environment -----------------------------------------------

describe("worktreeRoot", () => {
	test("is the env root when that directory is still on disk", async () => {
		const dir = scratch("pi-worktree-env-");
		await withEnv({ [ENV_ROOT]: dir }, () => expect(worktreeRoot()).toBe(dir));
	});

	test("ignores a root that no longer exists", async () => {
		await withEnv({ [ENV_ROOT]: join(scratch("pi-worktree-env-"), "gone") }, () =>
			expect(worktreeRoot()).toBeUndefined(),
		);
	});

	test("is undefined when the variable is unset or empty", async () => {
		await withEnv({ [ENV_ROOT]: undefined }, () => expect(worktreeRoot()).toBeUndefined());
		await withEnv({ [ENV_ROOT]: "" }, () => expect(worktreeRoot()).toBeUndefined());
	});
});

describe("resolveEffectiveCwd", () => {
	test("prefers the active worktree root over the session cwd", async () => {
		const dir = scratch("pi-worktree-env-");
		await withEnv({ [ENV_ROOT]: dir }, () => expect(resolveEffectiveCwd("/main/checkout")).toBe(dir));
	});

	test("falls back to the session cwd with no active worktree, or one that is gone", async () => {
		await withEnv({ [ENV_ROOT]: undefined }, () =>
			expect(resolveEffectiveCwd("/main/checkout")).toBe("/main/checkout"),
		);
		await withEnv({ [ENV_ROOT]: join(scratch("pi-worktree-env-"), "gone") }, () =>
			expect(resolveEffectiveCwd("/main/checkout")).toBe("/main/checkout"),
		);
	});
});

describe("isExtensionEnabled", () => {
	test("is enabled when the disable list is unset or empty", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: undefined }, () => expect(isExtensionEnabled("todo")).toBe(true));
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "" }, () => expect(isExtensionEnabled("todo")).toBe(true));
	});

	test("is disabled when the name appears in a comma-separated list", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "todo,job" }, () => {
			expect(isExtensionEnabled("todo")).toBe(false);
			expect(isExtensionEnabled("job")).toBe(false);
		});
	});

	test("is disabled when the name appears in a whitespace-separated list", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "todo,  job\nplan" }, () => {
			expect(isExtensionEnabled("todo")).toBe(false);
			expect(isExtensionEnabled("job")).toBe(false);
			expect(isExtensionEnabled("plan")).toBe(false);
		});
	});

	test("stays enabled for a name the list does not mention", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "does-not-exist,job" }, () => {
			expect(isExtensionEnabled("todo")).toBe(true);
			expect(isExtensionEnabled("does-not-exist")).toBe(false);
		});
	});

	test("compares names case-insensitively", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "TODO" }, () => expect(isExtensionEnabled("todo")).toBe(false));
	});
});

describe("isOffline", () => {
	test("is off when the variable is unset, empty, or says off", async () => {
		for (const value of [undefined, "", "0", "false", "no", "on"]) {
			await withEnv({ [ENV_OFFLINE]: value }, () => expect(isOffline(), String(value)).toBe(false));
		}
	});

	test("accepts the three on values in any case", async () => {
		for (const value of ["1", "true", "TRUE", "yes", " Yes "]) {
			await withEnv({ [ENV_OFFLINE]: value }, () => expect(isOffline(), value).toBe(true));
		}
	});
});

// --- Boundary helpers -------------------------------------------------------

describe("messageOf", () => {
	test("returns an Error's message", () => {
		expect(messageOf(new Error("boom"))).toBe("boom");
	});

	test("stringifies anything else", () => {
		expect(messageOf("plain")).toBe("plain");
		expect(messageOf(7)).toBe("7");
		expect(messageOf(undefined)).toBe("undefined");
	});
});

describe("escapeHtml", () => {
	test("escapes every HTML-significant character, attribute-safe", () => {
		expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
	});

	test("leaves ordinary text untouched", () => {
		expect(escapeHtml("plain text 123")).toBe("plain text 123");
		expect(escapeHtml("")).toBe("");
	});
});

describe("path containment", () => {
	test("accepts the root itself and a descendant", () => {
		const root = join(scratch("pi-path-"), "b");
		expect(isInside(root, root)).toBe(true);
		expect(isInside(root, join(root, "c"))).toBe(true);
		expect(isInside(root, join(root, "c", "d"))).toBe(true);
	});

	test("rejects a sibling, a parent, and a shared name prefix", () => {
		const base = scratch("pi-path-");
		const root = join(base, "b");
		expect(isInside(root, join(base, "c"))).toBe(false);
		expect(isInside(root, base)).toBe(false);
		expect(isInside(root, `${root}c`)).toBe(false);
	});

	test("realPathOfNearest resolves a missing leaf through its parent", () => {
		const base = scratch("pi-path-real-");
		expect(realPathOfNearest(join(base, "missing", "deep.txt"))).toBe(
			join(realpathSync.native(base), "missing", "deep.txt"),
		);
	});

	test("isInsideReal keeps ordinary paths inside the root", () => {
		const root = join(scratch("pi-path-real-"), "root");
		mkdirSync(root);
		writeFileSync(join(root, "real.txt"), "x");
		expect(isInsideReal(root, join(root, "real.txt"))).toBe(true);
	});

	// Windows requires Developer Mode/admin to create symlinks; skip those tests
	// rather than fail when the privilege is unavailable.
	const symlinkTest = (canCreateSymlinks() ? test : test.skip) as typeof test;

	symlinkTest("isInsideReal refuses a symlink that leaves the root", () => {
		const base = scratch("pi-path-symlink-");
		const root = join(base, "root");
		const outside = join(base, "outside");
		mkdirSync(root);
		mkdirSync(outside);
		symlinkSync(outside, join(root, "link"));
		expect(isInsideReal(root, join(root, "link", "file.txt"))).toBe(false);
	});
});

describe("createReadOnlyPolicy", () => {
	/** An annotation lookup over a fixed table. */
	function annotationsFor(table: Record<string, ToolAnnotations>) {
		return (name: string): ToolAnnotations | undefined => table[name];
	}

	test("defaults to deny for a tool it has never seen", () => {
		const policy = createReadOnlyPolicy();
		expect(policy.classify("bash")).toBe("mutating");
		expect(policy.check("bash")).toEqual({ block: true, reason: '"bash" is not read-only.' });
	});

	test("allows a named reader and a tool that declares the MCP read-only hint", () => {
		const policy = createReadOnlyPolicy({
			allow: ["read", "grep"],
			annotations: annotationsFor({ mcp__fs__read: { readOnlyHint: true } }),
		});
		expect(policy.isAllowed("read")).toBe(true);
		expect(policy.classify("mcp__fs__read")).toBe("read-only");
		expect(policy.check("mcp__fs__read")).toBeUndefined();
	});

	test("a deny entry outranks both the allow list and a read-only hint", () => {
		const policy = createReadOnlyPolicy({
			allow: ["read"],
			deny: ["read", "sneaky"],
			annotations: annotationsFor({ sneaky: { readOnlyHint: true } }),
		});
		expect(policy.isAllowed("read")).toBe(false);
		expect(policy.isAllowed("sneaky")).toBe(false);
	});

	test("does not treat a false or absent hint as read-only", () => {
		const policy = createReadOnlyPolicy({
			annotations: annotationsFor({ explicit: { readOnlyHint: false }, silent: {} }),
		});
		expect(policy.isAllowed("explicit")).toBe(false);
		expect(policy.isAllowed("silent")).toBe(false);
	});

	test("appends the guidance to a block reason", () => {
		const policy = createReadOnlyPolicy({ guidance: "Exit plan mode first." });
		expect(policy.check("write")?.reason).toBe('"write" is not read-only. Exit plan mode first.');
	});
});

describe("the rejected-call shape", () => {
	test("toolError carries the error content, the caller's details, and the flag", () => {
		expect(toolError("no such job", { action: "status", error: "no such job" })).toEqual({
			content: [{ type: "text", text: "Error: no such job" }],
			details: { action: "status", error: "no such job" },
			isError: true,
		});
	});

	test("errorResult keeps the previous state in details alongside the message", () => {
		expect(errorResult("stop", "j1 is already stopped")).toEqual({
			content: [{ type: "text", text: "Error: j1 is already stopped" }],
			details: { action: "stop", error: "j1 is already stopped" },
			isError: true,
		});
	});
});

describe("the transcript notice", () => {
	/** A stored notice as the session would hand it back. */
	const notice = (source: string, content = source): AgentMessage =>
		({
			role: "custom",
			...noticeMessage({ content, details: { source, title: content } }),
			timestamp: 0,
		}) as unknown as AgentMessage;

	const user = { role: "user", content: "hi", timestamp: 0 } as unknown as AgentMessage;

	test("noticeMessage stamps the shared type, display true, and both halves", () => {
		const message = noticeMessage({
			content: "3 jobs finished",
			details: { source: "job", title: "3 jobs finished" },
		});
		expect(message.customType).toBe(NOTICE_TYPE);
		expect(message.display).toBe(true);
		expect(message.content).toBe("3 jobs finished");
		expect(message.details.source).toBe("job");
	});

	test("isNotice accepts our notices and rejects everything else", () => {
		expect(isNotice(notice("job"))).toBe(true);
		expect(isNotice(user)).toBe(false);
		expect(
			isNotice({ role: "custom", customType: "other", content: "x", display: false, timestamp: 0 } as AgentMessage),
		).toBe(false);
	});

	test("pruneStaleNotices keeps only the newest notice of the given source", () => {
		const messages = [user, notice("job", "old"), notice("watch", "seen"), notice("job", "new")];
		const pruned = pruneStaleNotices(messages, "job");
		expect(pruned).toHaveLength(3);
		expect(pruned).toContain(messages[0]);
		expect(pruned).toContain(messages[2]);
		expect(pruned?.filter((message) => isNotice(message) && message.details?.source === "job")).toEqual([messages[3]]);
	});

	test("pruneStaleNotices leaves another source's notices alone", () => {
		expect(pruneStaleNotices([notice("watch", "a"), notice("watch", "b")], "job")).toBeUndefined();
	});

	test("pruneStaleNotices answers undefined when nothing is stale", () => {
		expect(pruneStaleNotices([user, notice("job")], "job")).toBeUndefined();
	});
});

describe("the turn-affinity prompt channel", () => {
	/** A channel double recording `post`/`postFile` deliveries in call order. */
	function fakeChannel(active = true) {
		const posted: string[] = [];
		const files: Array<{ path: string; name: string }> = [];
		const events: string[] = [];
		let fileResult = true;
		const channel: InteractionChannel = {
			isActive: () => active,
			request: async () => ({ kind: "cancelled" }),
			post: async (text) => {
				posted.push(text);
				events.push(`post:${text}`);
			},
			postFile: async (path, name) => {
				files.push({ path, name });
				events.push(`file:${name}`);
				return fileResult;
			},
		};
		return {
			channel,
			posted,
			files,
			events,
			setActive: (value: boolean) => {
				channel.isActive = () => value;
			},
			setFileResult: (value: boolean) => {
				fileResult = value;
			},
		};
	}

	/** A carrier whose `ctx.ui` installs `channel` when given. */
	function carrier(mode: InteractionMode | undefined, channel?: InteractionChannel): UIContextCarrier {
		const ui: Record<string, unknown> = { select: async () => undefined };
		if (channel) ui[INTERACTION_TURN_KEY] = channel;
		return { ui, mode };
	}

	const rich = async (): Promise<string> => "rich";
	const text = async (): Promise<string> => "text";

	test("remoteChannel is undefined without a channel, or while it is inactive", () => {
		expect(remoteChannel(carrier("tui"))).toBeUndefined();
		expect(remoteChannel(carrier("tui", fakeChannel(false).channel))).toBeUndefined();
		expect(remoteChannel({ ui: { [INTERACTION_TURN_KEY]: true } })).toBeUndefined();
	});

	test("remoteChannel returns the channel that owns the turn", () => {
		const { channel } = fakeChannel();
		expect(remoteChannel(carrier("tui", channel))).toBe(channel);
	});

	test("isRemoteTurn mirrors an active channel", () => {
		expect(isRemoteTurn(carrier("tui", fakeChannel().channel))).toBe(true);
		expect(isRemoteTurn(carrier("tui"))).toBe(false);
	});

	test("supportsCustomUI allows the rich component only for a local TUI turn", () => {
		expect(supportsCustomUI(carrier("tui"))).toBe(true);
		expect(supportsCustomUI(carrier("tui", fakeChannel().channel))).toBe(false);
		expect(supportsCustomUI(carrier("rpc"))).toBe(false);
		expect(supportsCustomUI(carrier("print"))).toBe(false);
	});

	test("askHuman runs custom for a local TUI turn and posts nothing", async () => {
		const { posted } = fakeChannel();
		const result = await askHuman(carrier("tui") as never, { custom: rich, dialogs: text, body: "unused" });
		expect(result).toBe("rich");
		expect(posted).toEqual([]);
	});

	test("askHuman runs the dialogs for a remote turn", async () => {
		const { channel } = fakeChannel();
		const result = await askHuman(carrier("tui", channel) as never, { custom: rich, dialogs: text });
		expect(result).toBe("text");
	});

	test("askHuman sends a file before the dialogs", async () => {
		const { channel, files, posted } = fakeChannel();
		const result = await askHuman(carrier("tui", channel) as never, {
			custom: rich,
			dialogs: text,
			file: { path: "/tmp/plan.md", name: "plan.md" },
			body: "fallback",
		});
		expect(result).toBe("text");
		expect(files).toEqual([{ path: "/tmp/plan.md", name: "plan.md" }]);
		expect(posted).toEqual([]);
	});

	test("askHuman falls back to the body when the file cannot be sent", async () => {
		const { channel, posted, setFileResult } = fakeChannel();
		setFileResult(false);
		await askHuman(carrier("tui", channel) as never, {
			custom: rich,
			dialogs: text,
			file: { path: "/tmp/plan.md", name: "plan.md" },
			body: "fallback",
		});
		expect(posted).toEqual(["fallback"]);
	});

	test("askHuman posts the digest after the file, before the dialogs", async () => {
		const { channel, files, events } = fakeChannel();
		const result = await askHuman(carrier("tui", channel) as never, {
			custom: rich,
			dialogs: text,
			file: { path: "/tmp/plan.md", name: "plan.md" },
			body: "fallback",
			note: "Plan: Demo (2 steps)",
		});
		expect(result).toBe("text");
		expect(files).toHaveLength(1);
		// The file goes out first; the digest follows, so the choices make sense even
		// when the attachment is never opened.
		expect(events).toEqual(["file:plan.md", "post:Plan: Demo (2 steps)"]);
	});

	test("askHuman posts the fallback text and then the digest", async () => {
		const { channel, posted, setFileResult } = fakeChannel();
		setFileResult(false);
		await askHuman(carrier("tui", channel) as never, {
			custom: rich,
			dialogs: text,
			file: { path: "/tmp/plan.md", name: "plan.md" },
			body: "full plan",
			note: "digest",
		});
		expect(posted).toEqual(["full plan", "digest"]);
	});

	test("askHuman posts a body when there is no file", async () => {
		const { channel, posted } = fakeChannel();
		await askHuman(carrier("tui", channel) as never, { custom: rich, dialogs: text, body: "plan text" });
		expect(posted).toEqual(["plan text"]);
	});

	test("askHuman posts no digest for a local turn", async () => {
		const { posted } = fakeChannel();
		const result = await askHuman(carrier("tui") as never, { custom: rich, dialogs: text, note: "digest" });
		expect(result).toBe("rich");
		expect(posted).toEqual([]);
	});

	test("askHuman still runs the dialogs when the preface throws", async () => {
		const { channel } = fakeChannel();
		channel.postFile = async () => {
			throw new Error("transport gone");
		};
		const result = await askHuman(carrier("tui", channel) as never, {
			custom: rich,
			dialogs: text,
			file: { path: "/tmp/plan.md", name: "plan.md" },
		});
		expect(result).toBe("text");
	});
});
