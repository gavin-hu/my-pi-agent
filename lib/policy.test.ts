import { describe, expect, test } from "bun:test";
import type { ToolAnnotations } from "@earendil-works/pi-coding-agent";
import { createReadOnlyPolicy } from "./policy.ts";

/** An annotation lookup over a fixed table. */
function annotationsFor(table: Record<string, ToolAnnotations>) {
	return (name: string): ToolAnnotations | undefined => table[name];
}

describe("createReadOnlyPolicy", () => {
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
