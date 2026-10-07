import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, normalizeConfig } from "../../extensions/guard/config.ts";
import { assessToolCall } from "../../extensions/guard/policy.ts";

const cwd = "/repo";

function assess(toolName: string, input: Record<string, unknown>, config = DEFAULT_CONFIG, annotations?: Record<string, unknown>) {
	return assessToolCall({ toolName, input, cwd, config, annotations });
}

describe("assessToolCall", () => {
	test("allows everything while disabled", () => {
		const config = normalizeConfig({ enabled: false });
		expect(assess("write", { path: ".env" }, config)).toEqual({ action: "allow" });
	});

	test("blocks a write to a protected path", () => {
		const verdict = assess("write", { path: ".env" });
		expect(verdict).toMatchObject({ action: "block", kind: "path" });
	});

	test("blocks an edit to a protected path, including absolute paths", () => {
		expect(assess("edit", { path: "certs/key.pem" }).action).toBe("block");
		expect(assess("edit", { path: "/repo/.git/config" }).action).toBe("block");
	});

	test("allows ordinary writes", () => {
		expect(assess("write", { path: "src/index.ts" }).action).toBe("allow");
	});

	test("blocks and confirms dangerous commands", () => {
		const blocked = assess("bash", { command: "rm -rf /" });
		expect(blocked).toMatchObject({ action: "block", kind: "command" });

		const confirmed = assess("bash", { command: "rm -rf node_modules" });
		expect(confirmed.action).toBe("confirm");
	});

	test("analyzes the powershell tool too", () => {
		expect(assess("powershell", { command: "sudo apt update" }).action).toBe("confirm");
	});

	test("confirms a destructive annotation", () => {
		const verdict = assess("mcp__db__drop", {}, DEFAULT_CONFIG, { destructiveHint: true });
		expect(verdict).toMatchObject({ action: "confirm", kind: "annotation" });
	});

	test("leaves a read-only annotation alone", () => {
		expect(assess("mcp__db__read", {}, DEFAULT_CONFIG, { readOnlyHint: true }).action).toBe("allow");
	});

	test("the missing-hints heuristic is opt-in and skips known tools", () => {
		const config = normalizeConfig({ annotations: { confirmMissingHints: true } });
		expect(assess("mcp__unknown__tool", {}, config).action).toBe("confirm");
		expect(assess("read", { path: "x" }, config).action).toBe("allow");
	});
});
