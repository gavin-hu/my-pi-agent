/**
 * What the child says, and how much of it the terminal draws.
 *
 * A child is a separate process whose stdout is JSON: every string it reports — a stop
 * reason, a model name, a tool argument printed on a call line — is untrusted text. The
 * cases here are the boundary the docs promise and the collapse that keeps one long line
 * from taking the transcript.
 */

import { describe, expect, test } from "bun:test";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { formatToolCall } from "./format.ts";
import { renderSubagentResult } from "./render.ts";
import { createResult, emptyUsage, truncateOutput } from "./stream.ts";
import type { SingleResult, SubagentDetails } from "./types.ts";
import { assistantMessage } from "../../test/helpers/fixtures/subagent.ts";
import { fakeTheme } from "../../test/helpers/fakes.ts";

/** A child's escape: clear the screen and set the window title. */
const ESCAPE = "\u001b[2J\u001b]0;pwned\u0007";

/** A finished child, built from the stream's own result so the block sees a real shape. */
function child(overrides: Partial<SingleResult> = {}): SingleResult {
	const result = createResult("explorer", "find auth");
	return {
		...result,
		exitCode: 0,
		messages: [assistantMessage("all done", { input: 100 })],
		usage: { ...emptyUsage(), turns: 1 },
		...overrides,
	};
}

function renderBlock(details: SubagentDetails): string {
	const result: AgentToolResult<unknown> = { content: [{ type: "text", text: "fallback" }], details };
	return renderSubagentResult(result, { expanded: false, isPartial: false }, fakeTheme).render(80).join("\n");
}

describe("child-authored text", () => {
	test("a stop reason cannot drive the terminal", () => {
		const text = renderBlock({ mode: "single", results: [child({ exitCode: 1, stopReason: ESCAPE })] });
		expect(text).not.toContain("\u001b");
		expect(text).not.toContain("\u0007");
	});

	test("a model name cannot drive the terminal", () => {
		const text = renderBlock({ mode: "single", results: [child({ model: `claude${ESCAPE}` })] });
		expect(text).not.toContain("\u001b");
		expect(text).not.toContain("\u0007");
	});

	test("a string offset is not printed as a line range", () => {
		const line = formatToolCall("read", { file_path: "/repo/a.ts", offset: "10", limit: 5 }, fakeTheme, true);
		expect(line).toContain("/repo/a.ts");
		expect(line).not.toContain("10-104");
	});
});

describe("truncating a large output", () => {
	test("cuts a multi-byte text on a character boundary", () => {
		// Three bytes per character: a code-unit cut would split one and leave a replacement mark.
		const text = "漢".repeat(1_000);
		const cut = truncateOutput(text, 100);
		const head = cut.split("\n\n[Output truncated")[0] ?? "";
		expect(Buffer.byteLength(head, "utf8")).toBeLessThanOrEqual(100);
		expect(head).not.toContain("\ufffd");
		expect(cut).toContain("bytes omitted");
	});

	test("leaves a text that already fits alone", () => {
		expect(truncateOutput("short", 100)).toBe("short");
	});
});

describe("the collapsed block", () => {
	test("keeps one very long line inside a readable budget", () => {
		const long = "x".repeat(50_000);
		const text = renderBlock({ mode: "single", results: [child({ messages: [assistantMessage(long)] })] });
		expect(text.length).toBeLessThan(2_000);
		// The hidden text is what expanding exists for, so the block must offer the expand key.
		expect(text).toContain("expand");
	});
});
