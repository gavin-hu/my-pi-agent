import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createReadOnlyPolicy } from "../../extensions/_shared/policy.ts";
import { createPlanPolicy } from "../../extensions/plan-mode/policy.ts";

describe("createReadOnlyPolicy — classification", () => {
	const policy = createReadOnlyPolicy({
		allow: ["read", "todo"],
		deny: ["write", "edit"],
	});

	test("known readers are read-only", () => {
		expect(policy.classify("read")).toBe("read-only");
		expect(policy.classify("todo")).toBe("read-only");
	});

	test("denied and unknown tools are mutating", () => {
		expect(policy.classify("write")).toBe("mutating");
		expect(policy.classify("bash")).toBe("mutating");
		expect(policy.classify("never-heard-of-it")).toBe("mutating");
	});

	test("only the read-only hint opens an unknown tool", () => {
		const annotated = createReadOnlyPolicy({
			annotations: (name) => (name === "web_search" ? { readOnlyHint: true } : { readOnlyHint: false }),
		});
		expect(annotated.classify("web_search")).toBe("read-only");
		expect(annotated.classify("write")).toBe("mutating");
	});

	test("deny beats a read-only hint, allow beats a missing one", () => {
		const conflicting = createReadOnlyPolicy({
			allow: ["todo"],
			deny: ["write"],
			annotations: (name) => (name === "write" ? { readOnlyHint: true } : undefined),
		});
		expect(conflicting.classify("write")).toBe("mutating");
		expect(conflicting.classify("todo")).toBe("read-only");
	});

	test("isAllowed is true for everything but mutating tools", () => {
		expect(policy.isAllowed("read")).toBe(true);
		expect(policy.isAllowed("bash")).toBe(false);
		expect(policy.isAllowed("write")).toBe(false);
	});
});

describe("createReadOnlyPolicy — check", () => {
	const policy = createReadOnlyPolicy({ allow: ["read"], deny: ["write"] });

	test("allows a read-only call", () => {
		expect(policy.check("read")).toBeUndefined();
	});

	test("blocks a mutating call with an actionable reason", () => {
		const blocked = policy.check("write");
		expect(blocked?.block).toBe(true);
		expect(blocked?.reason).toContain('"write" is not read-only');
	});

	test("appends guidance when provided", () => {
		const guided = createReadOnlyPolicy({ allow: ["read"], guidance: "Exit first." });
		expect(guided.check("bash")?.reason).toContain("Exit first.");
	});
});

describe("createPlanPolicy", () => {
	const pi = (tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }>) =>
		({ getAllTools: () => tools }) as unknown as ExtensionAPI;
	const policy = createPlanPolicy(pi([]));

	test("allows the structured readers and the plan/goal trackers", () => {
		for (const name of ["read", "grep", "find", "ls", "todo", "goal", "git"]) {
			expect(policy.classify(name)).toBe("read-only");
		}
	});

	test("blocks write, edit, shell, and enter_plan_mode", () => {
		for (const name of ["write", "edit", "bash", "powershell", "enter_plan_mode"]) {
			expect(policy.check(name)?.block).toBe(true);
		}
	});

	test("blocks unknown tools (the cross-platform hole)", () => {
		expect(policy.check("mcp__danger")?.block).toBe(true);
	});

	test("opens a tool that carries the MCP read-only hint", () => {
		const annotated = createPlanPolicy(pi([{ name: "web_search", annotations: { readOnlyHint: true } }]));
		expect(annotated.check("web_search")).toBeUndefined();
	});

	test("deny wins over a read-only hint on a shell tool", () => {
		const annotated = createPlanPolicy(pi([{ name: "bash", annotations: { readOnlyHint: true } }]));
		expect(annotated.check("bash")?.block).toBe(true);
	});
});
