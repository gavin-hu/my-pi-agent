import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { tempDir, withAgentDir } from "../../test/helpers/env.ts";
import { DEFAULT_CONFIG, loadWechatConfig, normalizeConfig } from "./config.ts";

describe("normalizeConfig", () => {
	test("falls back to defaults for an absent object", () => {
		expect(normalizeConfig(undefined, DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
	});

	test("clamps pollTimeoutMs and maxReplyChars into range", () => {
		const config = normalizeConfig({ pollTimeoutMs: 5, maxReplyChars: 999999 }, DEFAULT_CONFIG);
		expect(config.pollTimeoutMs).toBe(1000);
		expect(config.maxReplyChars).toBe(20000);
	});

	test("keeps only non-empty string peers", () => {
		const config = normalizeConfig({ allowedPeers: ["a", "", 3, "b"] }, DEFAULT_CONFIG);
		expect(config.allowedPeers).toEqual(["a", "b"]);
	});

	test("caps botAgent at 256 characters", () => {
		const config = normalizeConfig({ botAgent: "x".repeat(400) }, DEFAULT_CONFIG);
		expect(config.botAgent.length).toBe(256);
	});

	test("accepts only a boolean remotePrompts", () => {
		expect(normalizeConfig({ remotePrompts: false }, DEFAULT_CONFIG).remotePrompts).toBe(false);
		expect(normalizeConfig({ remotePrompts: "yes" }, DEFAULT_CONFIG).remotePrompts).toBe(true);
	});

	test("clamps maxMediaBytes into range", () => {
		const low = normalizeConfig({ maxMediaBytes: 1 }, DEFAULT_CONFIG);
		const high = normalizeConfig({ maxMediaBytes: 999 * 1024 * 1024 }, DEFAULT_CONFIG);
		expect(low.maxMediaBytes).toBe(1024);
		expect(high.maxMediaBytes).toBe(100 * 1024 * 1024);
	});

	test("cleans the CDN base URL of trailing slashes", () => {
		const config = normalizeConfig({ cdnBaseUrl: "  https://cdn.example.com/c2c///  " }, DEFAULT_CONFIG);
		expect(config.cdnBaseUrl).toBe("https://cdn.example.com/c2c");
	});

	test("only accepts a boolean typingIndicator", () => {
		expect(normalizeConfig({ typingIndicator: false }, DEFAULT_CONFIG).typingIndicator).toBe(false);
		expect(normalizeConfig({ typingIndicator: "yes" }, DEFAULT_CONFIG).typingIndicator).toBe(true);
	});
});

describe("loadWechatConfig", () => {
	test("merges the project file over the defaults", async () => {
		await withAgentDir(async () => {
			const cwd = tempDir("wechat-cwd-");
			mkdirSync(join(cwd, CONFIG_DIR_NAME), { recursive: true });
			writeFileSync(
				join(cwd, CONFIG_DIR_NAME, "wechat.json"),
				JSON.stringify({ maxReplyChars: 12, allowedPeers: ["p"] }),
			);
			const config = loadWechatConfig(cwd);
			expect(config.maxReplyChars).toBe(12);
			expect(config.allowedPeers).toEqual(["p"]);
			expect(config.botAgent).toBe(DEFAULT_CONFIG.botAgent);
		});
	});
});
