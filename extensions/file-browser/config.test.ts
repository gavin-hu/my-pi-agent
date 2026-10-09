import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, normalizeConfig, PORT_BASE, PORT_RANGE, randomPort } from "./config.ts";

describe("randomPort", () => {
	test("stays inside the per-session range", () => {
		for (let draw = 0; draw < 200; draw++) {
			const port = randomPort();
			expect(port).toBeGreaterThanOrEqual(PORT_BASE);
			expect(port).toBeLessThan(PORT_BASE + PORT_RANGE);
		}
	});
});

describe("normalizeConfig port", () => {
	test("keeps the zero default that picks a per-session port", () => {
		expect(normalizeConfig(undefined).port).toBe(DEFAULT_CONFIG.port);
		expect(DEFAULT_CONFIG.port).toBe(0);
	});

	test("keeps and clamps an explicit port", () => {
		expect(normalizeConfig({ port: 8080 }).port).toBe(8080);
		expect(normalizeConfig({ port: 70000 }).port).toBe(65535);
	});
});
