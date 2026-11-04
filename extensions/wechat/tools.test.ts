/**
 * The `send_wechat` tool: owner-only proactive text, one image, or one file.
 *
 * The bridge is a double, so the tool's contract is exercised without a poller:
 * what it accepts, what it reports on success and failure, and what it renders.
 */

import { describe, expect, test } from "bun:test";
import { fakeTheme, createFakePi, toolRenderContext } from "../../test/helpers/fakes.ts";
import type { Bridge, OwnerMessage, SendResult } from "./bridge.ts";
import { registerTools, TOOL_NAME } from "./tools.ts";

function stubBridge(outcome: SendResult, calls: OwnerMessage[] = []): Bridge {
	return {
		async sendToOwner(message: OwnerMessage): Promise<SendResult> {
			calls.push(message);
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
	test("registers the owner-only tool with one text, one image, and one file", () => {
		const tool = toolFor(() => undefined);
		expect(tool.name).toBe(TOOL_NAME);
		expect(tool.executionMode).toBe("sequential");
		expect(tool.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: true });
		// The model cannot choose a recipient: the owner is the only target.
		expect(Object.keys(tool.parameters.properties)).toEqual(["text", "image", "file"]);
		expect(tool.parameters.required ?? []).toEqual([]);
	});
});

describe("send_wechat execution", () => {
	test("sends the text to the bridge and reports success", async () => {
		const calls: OwnerMessage[] = [];
		const tool = toolFor(() => stubBridge({ ok: true }, calls));
		const result = await tool.execute("id", { text: "hello" });
		expect(calls).toEqual([{ text: "hello" }]);
		expect(result.details).toEqual({ sent: true });
		expect(result.isError).toBeUndefined();
	});

	test("sends one image path to the bridge, as a picture", async () => {
		const calls: OwnerMessage[] = [];
		const tool = toolFor(() => stubBridge({ ok: true }, calls));
		const result = await tool.execute("id", { image: "build/timing.png" });
		expect(calls).toEqual([{ image: "build/timing.png" }]);
		expect(result.details).toEqual({ sent: true });
	});

	test("sends one file path to the bridge, as a document", async () => {
		const calls: OwnerMessage[] = [];
		const tool = toolFor(() => stubBridge({ ok: true }, calls));
		const result = await tool.execute("id", { file: "reports/weekly.pdf" });
		expect(calls).toEqual([{ file: "reports/weekly.pdf" }]);
		expect(result.details).toEqual({ sent: true });
	});

	test("refuses none, or more than one, of text, image, and file", async () => {
		const calls: OwnerMessage[] = [];
		const tool = toolFor(() => stubBridge({ ok: true }, calls));
		// Every shape counts toward "exactly one": a pair is as undecidable as an empty call.
		const callsToRefuse: Array<Record<string, string>> = [
			{},
			{ text: "hello", image: "build/timing.png" },
			{ text: "hello", file: "reports/weekly.pdf" },
			{ image: "build/timing.png", file: "reports/weekly.pdf" },
		];
		for (const args of callsToRefuse) {
			const result = await tool.execute("id", args);
			expect(result.isError).toBe(true);
			expect(result.details.error).toContain("exactly one of text, image, or file");
		}
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

	test("hands Pi a partial result so the row repaints while the send is in flight", async () => {
		let release: (outcome: SendResult) => void = () => {};
		const settled = new Promise<SendResult>((resolve) => {
			release = resolve;
		});
		const bridge = { sendToOwner: () => settled } as unknown as Bridge;
		const tool = toolFor(() => bridge);
		const partials: unknown[] = [];
		const pending = tool.execute("id", { text: "hello" }, undefined, (partial: unknown) => partials.push(partial));
		expect(partials).toHaveLength(1);
		release({ ok: true });
		// The host replaces the partial with the result it settles on.
		expect((await pending).details).toEqual({ sent: true });
	});
});

describe("send_wechat rendering", () => {
	test("names a file rather than its path on the call line", () => {
		const tool = toolFor(() => undefined);
		const line = tool
			.renderCall({ file: "/tmp/reports/weekly.pdf" }, fakeTheme, toolRenderContext())
			.render(80)
			.join("\n");
		expect(line).toContain("weekly.pdf");
		expect(line).not.toContain("/tmp/reports");
	});

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

	test("a slow send says it is sending, and the settled line carries the duration", () => {
		const tool = toolFor(() => stubBridge({ ok: true }));
		const context = { ...toolRenderContext(), durationMs: 2500 };
		const live = tool
			.renderResult({ content: [], details: undefined }, { expanded: false, isPartial: true }, fakeTheme, context)
			.render(80)
			.join("\n");
		// The live frame's number comes off the wall clock, so the word is what a suite can hold;
		// `elapsedSuffix`'s own numbers are `lib/tui`'s case.
		expect(live).toContain("Sending");
		const settled = tool
			.renderResult(
				{ content: [{ type: "text", text: "Sent to the WeChat owner." }], details: { sent: true } },
				{ expanded: false, isPartial: false },
				fakeTheme,
				context,
			)
			.render(80)
			.join("\n");
		expect(settled).toContain("sent to WeChat owner");
		expect(settled).toContain("2.5s");
		// The settled frame clears the interval the live line started, so nothing ticks after it.
		expect((context.state as { elapsedTimer?: unknown }).elapsedTimer).toBeUndefined();
	});
});
