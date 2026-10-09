import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG, isFormatEnabled, loadConfig, normalizeConfig } from "./config.ts";
import { tempDir, withAgentDir } from "../../test/helpers/env.ts";

describe("normalizeConfig", () => {
	test("clamps numeric fields over the defaults", () => {
		const config = normalizeConfig({ maxFileBytes: 10, maxChars: 5 });
		expect(config.maxFileBytes).toBe(1_024);
		expect(config.maxChars).toBe(200);
	});

	test("merges formats over registry defaults and ignores unknown or non-boolean keys", () => {
		const config = normalizeConfig({ formats: { pdf: false, xlsx: false, docx: "no", pptx: true } });
		expect(config.formats.pdf).toBe(false);
		expect(config.formats.docx).toBe(true);
		expect(config.formats.xlsx).toBe(false);
		expect("pptx" in config.formats).toBe(false);
	});

	test("enables every registered format by default", () => {
		expect(DEFAULT_CONFIG.formats).toEqual({ pdf: true, docx: true, xlsx: true });
	});

	test("uses the registry defaults when the file is missing", () => {
		expect(normalizeConfig(undefined).formats).toEqual(DEFAULT_CONFIG.formats);
	});
});

describe("loadConfig", () => {
	test("project config overrides global and keeps registry defaults", async () => {
		await withAgentDir(async (agentDir) => {
			writeFileSync(join(agentDir, "doc.json"), JSON.stringify({ maxChars: 1000, formats: { pdf: false } }));
			const cwd = tempDir("doc-config-");
			mkdirSync(join(cwd, ".pi"), { recursive: true });
			writeFileSync(join(cwd, ".pi", "doc.json"), JSON.stringify({ formats: { pdf: true } }));

			const config = loadConfig(cwd);
			expect(config.maxChars).toBe(1000);
			expect(config.formats.pdf).toBe(true);
			expect(config.formats.docx).toBe(true);
			expect(isFormatEnabled(config, "pdf")).toBe(true);
		});
	});
});
