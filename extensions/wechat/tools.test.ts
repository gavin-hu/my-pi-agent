import { describe, expect, test } from "bun:test";
import { createFakePi } from "../../test/helpers/fakes.ts";
import type { Bridge, SendResult } from "./bridge.ts";
import { registerTools, TOOL_NAME } from "./tools.ts";

function stubBridge(outcome: SendResult, calls: string[] = []): Bridge {
	return {
		async sendToOwner(text: string): Promise<SendResult> {
			calls.push(text);
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

describe("send_wechat tool", () => {
	test("registers the tool", () => {
		expect(toolFor(() => undefined).name).toBe(TOOL_NAME);
	});

	test("sends the text to the bridge and reports success", async () => {
		const calls: string[] = [];
		const tool = toolFor(() => stubBridge({ ok: true }, calls));
		const result = await tool.execute("id", { text: "hello" });
		expect(calls).toEqual(["hello"]);
		expect(result.details).toEqual({ sent: true });
		expect(result.isError).toBeUndefined();
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
