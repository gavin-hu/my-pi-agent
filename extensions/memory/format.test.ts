import { describe, expect, test } from "bun:test";
import {
	buildInjection,
	formatCallText,
	formatNotice,
	formatResultText,
	injectionPlan,
	MEMORY_CONTEXT_MARKER,
} from "./format.ts";
import type { MemoryDetails } from "./types.ts";

function details(over: Partial<MemoryDetails> = {}): MemoryDetails {
	return { action: "list", scope: "project", project: [], global: [], changed: false, ...over };
}

describe("injection body", () => {
	test("returns undefined when nothing is stored", () => {
		expect(buildInjection({ project: [], global: [] }, 8192)).toBeUndefined();
	});

	test("lists the project then global sections under the marker", () => {
		const body = buildInjection({ project: ["p1"], global: ["g1"] }, 8192);
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

describe("injection plan", () => {
	test("returns undefined when nothing is stored, so the caller can skip the message", () => {
		expect(injectionPlan({ project: [], global: [] }, 8192)).toBeUndefined();
	});

	test("reports no omitted notes when everything fits", () => {
		const plan = injectionPlan({ project: ["p1"], global: ["g1"] }, 8192);
		expect(plan?.omitted).toEqual({ project: 0, global: 0 });
	});

	test("attributes omissions to the store that overflowed", () => {
		const entries = Array.from({ length: 200 }, (_, index) => `note ${index} ${"x".repeat(40)}`);
		const plan = injectionPlan({ project: entries.slice(0, 100), global: entries.slice(100) }, 512);
		expect(plan?.omitted.project).toBeGreaterThan(0);
		expect(plan?.omitted.global).toBeGreaterThan(0);
		// One tail names the total, not one line per scope.
		const missing = (plan?.omitted.project ?? 0) + (plan?.omitted.global ?? 0);
		expect(plan?.lines.at(-1)).toBe(`- (+${missing} more; use the memory tool)`);
	});
});

describe("memory text", () => {
	test("formatCallText names the action, scope, and note", () => {
		expect(formatCallText({ action: "add", scope: "global", text: "x" })).toBe("→ add (global): x");
		expect(formatCallText({ action: "update", scope: "global", text: "a", to: "b" })).toBe("→ update (global): a → b");
		expect(formatCallText({ action: "list" })).toBe("→ list");
	});

	test("formatCallText leaves out a note that has not arrived yet", () => {
		expect(formatCallText({}, false)).toBe("→ …");
		expect(formatCallText({ action: "add" }, false)).toBe("→ add (project)");
		expect(formatCallText({ action: "add" })).toBe("→ add (project)");
		expect(formatCallText({ action: "update", text: "a" })).toBe("→ update (project): a");
		expect(formatCallText({})).toBe("");
	});

	test("formatResultText confirms a write without repeating the note", () => {
		const added = formatResultText(details({ action: "add", changed: true, entry: "x", project: ["x"] }));
		expect(added).toBe("Added to project memory\nNow 1 project, 0 global.");
		expect(formatResultText(details({ action: "add", changed: false, entry: "x" }))).toContain(
			"Already in project memory",
		);
		expect(formatResultText(details({ action: "add", changed: false, entry: "use tabs", existing: "Use tabs" }))).toBe(
			"Already in project memory (near-duplicate): Use tabs",
		);
		expect(formatResultText(details({ action: "add", changed: false, entry: "x", existing: "x" }))).toBe(
			"Already in project memory: x",
		);
		expect(formatResultText(details({ action: "forget", changed: true, entry: "x" }))).toBe(
			"Removed from project memory\nNow 0 project, 0 global.",
		);
	});

	test("formatResultText reports update and a no-op update", () => {
		expect(formatResultText(details({ action: "update", changed: true, entry: "a", to: "b", project: ["b"] }))).toBe(
			"Updated project memory\nNow 1 project, 0 global.",
		);
		expect(formatResultText(details({ action: "update", changed: false, entry: "a", to: "a" }))).toContain(
			"Already set in project memory: a",
		);
	});

	test("formatResultText lists both scopes", () => {
		const text = formatResultText(details({ action: "list", project: ["p"], global: ["g"] }));
		expect(text).toContain("project (1):");
		expect(text).toContain("global (1):");
	});

	test("formatResultText caps a collapsed list and expands all of it", () => {
		const many = Array.from({ length: 14 }, (_, index) => `note ${index}`);
		const collapsed = formatResultText(details({ action: "list", project: many }));
		expect(collapsed).toContain("- (+2 more)");
		const expanded = formatResultText(details({ action: "list", project: many }), true);
		expect(expanded).not.toContain("more)");
		expect(expanded).toContain("- note 13");
	});

	test("formatResultText surfaces an error", () => {
		expect(formatResultText(details({ error: "boom" }))).toBe("Error: boom");
	});

	test("formatNotice reports an empty store", () => {
		expect(formatNotice({ project: [], global: [] })).toBe("No durable memory stored yet.");
	});

	test("formatNotice lists both stores", () => {
		expect(formatNotice({ project: ["p"], global: ["g"] })).toBe("Memory:\nproject (1):\n- p\nglobal (1):\n- g");
	});
});
