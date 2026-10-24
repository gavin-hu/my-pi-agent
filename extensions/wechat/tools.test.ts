/**
 * The `send_wechat` tool: owner-only proactive text or one image.
 *
 * The bridge is a double, so the tool's contract is exercised without a poller:
 * what it accepts, what it reports on success and failure, and what it renders.
 */

import { describe, expect, test } from "bun:test";
import { fakeTheme, createFakePi } from "../../test/helpers/fakes.ts";
import type { Bridge, SendResult } from "./bridge.ts";
import { registerTools, TOOL_NAME } from "./tools.ts";

function stubBridge(outcome: SendResult, calls: Array<{ text?: string; image?: string }> = []): Bridge {
	return {
		async sendToOwner(text: string | undefined, image?: string): Promise<SendResult> {
			calls.push({ text, image });
			return outcome;
		},
	} as unknown as Bridge;
}

function toolFor(getBridge: () => Bridge | undefined) {
	const fake = createFakePi();
	registerTools(fake.pi, { getBridge });
	const tool = fake.tools.get(TOOL_NAME);
	if (!tool) throw new Error("tool not registered");
	return tool;
}

describe("send_wechat registration", () => {
	test("registers the owner-only tool with one text and one image", () => {
		const tool = toolFor(() => undefined);
		expect(tool.name).toBe(TOOL_NAME);
		expect(tool.executionMode).toBe("sequential");
		expect(tool.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: true });
		// The model cannot choose a recipient: the owner is the only target.
		expect(Object.keys(tool.parameters.properties)).toEqual(["text", "image"]);
		expect(tool.parameters.required ?? []).toEqual([]);
	});
});

describe("send_wechat execution", () => {
	test("sends the text to the bridge and reports success", async () => {
		const calls: Array<{ text?: string; image?: string }> = [];
		const tool = toolFor(() => stubBridge({ ok: true }, calls));
		const result = await tool.execute("id", { text: "hello" });
		expect(calls).toEqual([{ text: "hello", image: undefined }]);
		expect(result.details).toEqual({ sent: true });
		expect(result.isError).toBeUndefined();
	});

	test("sends one image path to the bridge", async () => {
		const calls: Array<{ text?: string; image?: string }> = [];
		const tool = toolFor(() => stubBridge({ ok: true }, calls));
		const result = await tool.execute("id", { image: "build/timing.png" });
		expect(calls).toEqual([{ text: undefined, image: "build/timing.png" }]);
		expect(result.details).toEqual({ sent: true });
	});

	test("refuses neither or both of text and image", async () => {
		const calls: Array<{ text?: string; image?: string }> = [];
		const tool = toolFor(() => stubBridge({ ok: true }, calls));
		const empty = await tool.execute("id", {});
		const both = await tool.execute("id", { text: "hello", image: "build/timing.png" });
		expect(empty.isError).toBe(true);
		expect(both.isError).toBe(true);
		expect(empty.details.error).toContain("exactly one of text or image");
		expect(calls).toEqual([]);
	});

	test("errors when the bridge is not started", async () => {
		const tool = toolFor(() => undefined);
		const result = await tool.execute("id", { text: "hello" });
		expect(result.isError).toBe(true);
		expect(result.details.sent).toBe(false);
		expect(result.details.error).toContain("not started");
	});

	test("errors when the send fails", async () => {
		const tool = toolFor(() => stubBridge({ ok: false, error: "network down" }));
		const result = await tool.execute("id", { text: "hello" });
		expect(result.isError).toBe(true);
		expect(result.details).toEqual({ sent: false, error: "network down" });
	});
});

describe("send_wechat rendering", () => {
	test("sanitizes the error text in the result renderer", () => {
		const tool = toolFor(() => undefined);
		const text = tool
			.renderResult(
				{ content: [{ type: "text", text: "" }], details: { sent: false, error: "bad\u001b[31mtext" } },
				{ expanded: false, isPartial: false },
				fakeTheme,
				{ lastComponent: undefined },
			)
			.render(80)
			.join("\n");
		expect(text).toContain("bad");
		expect(text).not.toContain("\u001b");
	});
});
