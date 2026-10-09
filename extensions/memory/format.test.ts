import { describe, expect, test } from "bun:test";
import { buildInjection, formatCallText, formatNotice, formatResultText, MEMORY_CONTEXT_MARKER } from "./format.ts";
import type { MemoryDetails } from "./types.ts";

function details(over: Partial<MemoryDetails> = {}): MemoryDetails {
	return { action: "list", scope: "project", project: [], global: [], changed: false, ...over };
}

describe("buildInjection", () => {
	test("returns undefined when nothing is stored", () => {
		expect(buildInjection({ project: [], global: [] }, 8192)).toBeUndefined();
	});

	test("lists the project then global sections under the marker", () => {
		const body = buildInjection({ project: ["p1"], global: ["g1"] }, 8192);
		expect(body).toBeDefined();
		expect(body?.startsWith(MEMORY_CONTEXT_MARKER)).toBe(true);
		expect(body).toContain("project:\n- p1");
		expect(body).toContain("global:\n- g1");
		expect(body?.indexOf("project:")).toBeLessThan(body?.indexOf("global:") ?? 0);
	});

	test("omits an empty project section, as for an untrusted project", () => {
		const body = buildInjection({ project: [], global: ["g1"] }, 8192);
		expect(body).not.toContain("project:");
		expect(body).toContain("global:\n- g1");
	});

	test("caps the body and reports the omitted count", () => {
		const entries = Array.from({ length: 200 }, (_, index) => `note ${index} ${"x".repeat(40)}`);
		const body = buildInjection({ project: [], global: entries }, 512);
		expect(body).toBeDefined();
		expect(Buffer.byteLength(body ?? "", "utf-8")).toBeLessThanOrEqual(512);
		expect(body).toMatch(/\(\+\d+ more; use the memory tool\)/);
	});
});

describe("memory text", () => {
	test("formatCallText names the action, scope, and note", () => {
		expect(formatCallText({ action: "add", scope: "global", text: "x" })).toBe("→ add (global): x");
		expect(formatCallText({ action: "list" })).toBe("→ list");
	});

	test("formatResultText reports add, duplicate, and forget", () => {
		expect(formatResultText(details({ action: "add", changed: true, entry: "x", project: ["x"] }))).toContain(
			"Added to project memory: x",
		);
		expect(formatResultText(details({ action: "add", changed: false, entry: "x" }))).toContain(
			"Already in project memory",
		);
		expect(formatResultText(details({ action: "forget", changed: true, entry: "x" }))).toContain(
			"Removed from project memory: x",
		);
	});

	test("formatResultText lists both scopes", () => {
		const text = formatResultText(details({ action: "list", project: ["p"], global: ["g"] }));
		expect(text).toContain("project (1):");
		expect(text).toContain("global (1):");
	});

	test("formatResultText surfaces an error", () => {
		expect(formatResultText(details({ error: "boom" }))).toBe("Error: boom");
	});

	test("formatNotice reports an empty store", () => {
		expect(formatNotice({ project: [], global: [] })).toBe("No durable memory stored yet.");
	});
});
