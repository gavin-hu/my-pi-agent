import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, normalizeConfig } from "../../extensions/guard/config.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
});

describe("normalizeConfig", () => {
	test("returns the base config for missing input", () => {
		expect(normalizeConfig(undefined)).toEqual(DEFAULT_CONFIG);
	});

	test("only a boolean enables the master switch and remembers confirmations", () => {
		expect(normalizeConfig({ enabled: false }).enabled).toBe(false);
		expect(normalizeConfig({ enabled: "no" as unknown as boolean }).enabled).toBe(DEFAULT_CONFIG.enabled);
		expect(normalizeConfig({ rememberConfirmations: false }).rememberConfirmations).toBe(false);
	});

	test("validates the protected action and non-interactive policy", () => {
		expect(normalizeConfig({ protected: { action: "confirm" } }).protected.action).toBe("confirm");
		expect(normalizeConfig({ protected: { action: "nonsense" } }).protected.action).toBe(DEFAULT_CONFIG.protected.action);
		expect(normalizeConfig({ nonInteractive: "allow" }).nonInteractive).toBe("allow");
		expect(normalizeConfig({ nonInteractive: "maybe" }).nonInteractive).toBe(DEFAULT_CONFIG.nonInteractive);
	});

	test("keeps an explicit empty protected-path list", () => {
		const config = normalizeConfig({ protected: { paths: [] } });
		expect(config.protected.paths).toEqual([]);
	});

	test("adds extra command patterns without clobbering the defaults", () => {
		const config = normalizeConfig({ commands: { block: ["^boom$"], confirm: ["^careful$"] } });
		expect(config.commands.block).toEqual(["^boom$"]);
		expect(config.commands.confirm).toEqual(["^careful$"]);
		expect(config.commands.includeBuiltins).toBe(true);
	});

	test("clamps the confirmation timeout", () => {
		expect(normalizeConfig({ confirmTimeoutMs: -10 }).confirmTimeoutMs).toBe(0);
		expect(normalizeConfig({ confirmTimeoutMs: 99_999_999 }).confirmTimeoutMs).toBe(3_600_000);
	});

	test("merges nested objects over the base", () => {
		const config = normalizeConfig({ annotations: { confirmMissingHints: true } });
		expect(config.annotations.confirmMissingHints).toBe(true);
		expect(config.annotations.confirmDestructive).toBe(DEFAULT_CONFIG.annotations.confirmDestructive);
	});
});

describe("loadConfig", () => {
	test("merges the global file then the project file, with project winning", async () => {
		const { loadConfig } = await import("../../extensions/guard/config.ts");
		const globalDir = mkdtempSync(join(tmpdir(), "guard-global-"));
		const cwd = mkdtempSync(join(tmpdir(), "guard-project-"));
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(globalDir, "guard.json"), JSON.stringify({ nonInteractive: "allow", protected: { action: "confirm" } }));
		writeFileSync(join(cwd, ".pi", "guard.json"), JSON.stringify({ protected: { action: "block" } }));
		process.env.PI_CODING_AGENT_DIR = globalDir;

		const config = loadConfig(cwd);
		expect(config.nonInteractive).toBe("allow");
		expect(config.protected.action).toBe("block");
	});

	test("ignores malformed files", async () => {
		const { loadConfig } = await import("../../extensions/guard/config.ts");
		const globalDir = mkdtempSync(join(tmpdir(), "guard-global-"));
		const cwd = mkdtempSync(join(tmpdir(), "guard-project-"));
		writeFileSync(join(globalDir, "guard.json"), "{ not json");
		process.env.PI_CODING_AGENT_DIR = globalDir;

		expect(loadConfig(cwd)).toEqual(DEFAULT_CONFIG);
	});
});
