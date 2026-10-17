import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { withAgentDir } from "../../../test/helpers/env.ts";
import { coloringTheme, fakeTheme } from "../../../test/helpers/fakes.ts";
import { bootDoctor, failingExec } from "../../../test/helpers/fixtures/doctor.ts";

describe("doctor wiring", () => {
	test("registers a read-only tool", () => {
		const { fake } = bootDoctor();
		const tool = fake.tools.get("run_doctor");
		expect(tool).toBeDefined();
		expect(tool.annotations.readOnlyHint).toBe(true);
		expect(tool.annotations.destructiveHint).toBe(false);
		expect(tool.outputSchema).toBeDefined();
		expect(fake.commands.has("doctor")).toBe(false);
	});

	test("renders the call line with the tool name in bold", () => {
		const { fake } = bootDoctor();
		const tool = fake.tools.get("run_doctor");
		const line: string = tool.renderCall({}, coloringTheme, { lastComponent: undefined }).render(80)[0];
		expect(line).toContain("[toolTitle][bold]run_doctor");
	});

	test("reads the subject as the body and a refresh as faint", () => {
		const { fake } = bootDoctor();
		const tool = fake.tools.get("run_doctor");
		const line: string = tool
			.renderCall({ extension: "bytefly", refresh: true }, coloringTheme, { lastComponent: undefined })
			.render(80)[0];
		expect(line).toContain("[text]bytefly");
		expect(line).toContain("[dim] (refresh)");
	});
});

describe("proactive probe", () => {
	test("warns once when an enabled extension is missing a hard requirement", async () => {
		const { start, notices } = bootDoctor({ exec: failingExec });
		await start();
		expect(notices).toHaveLength(1);
		expect(notices[0]?.kind).toBe("warning");
		expect(notices[0]?.message).toContain("worktree");
		expect(notices[0]?.message).toContain("run /bytefly doctor");
	});

	test("stays quiet when every hard requirement is met", async () => {
		const { start, notices } = bootDoctor();
		await start();
		expect(notices).toEqual([]);
	});

	test("stays quiet when proactive checks are disabled", async () => {
		await withAgentDir(async (dir) => {
			writeFileSync(join(dir, "bytefly.json"), JSON.stringify({ doctor: { proactive: false } }));
			const { start, notices } = bootDoctor({ exec: failingExec });
			await start();
			expect(notices).toEqual([]);
		});
	});

	test("stays quiet in Pi's quiet startup mode", async () => {
		const { start, notices } = bootDoctor({ exec: failingExec, settings: { quietStartup: true } });
		await start();
		expect(notices).toEqual([]);
	});

	test("still warns when quietStartup only keeps the header", async () => {
		const { start, notices } = bootDoctor({ exec: failingExec, settings: { quietStartup: "header" } });
		await start();
		expect(notices).toHaveLength(1);
	});

	test("stays quiet without a UI to warn", async () => {
		const { start, notices } = bootDoctor({ exec: failingExec, mode: "print", hasUI: false });
		await start();
		expect(notices).toEqual([]);
	});
});

describe("session state", () => {
	test("drops the cached findings on shutdown", async () => {
		const { runtime, start, stop } = bootDoctor();
		await start();
		await runtime.probeAll();
		expect(runtime.peek()).toBeDefined();
		await stop();
		expect(runtime.peek()).toBeUndefined();
	});
});

describe("run_doctor", () => {
	test("returns typed findings and a text report", async () => {
		const { fake, ctx } = bootDoctor({ exec: failingExec });
		const tool = fake.tools.get("run_doctor");
		const result = await tool.execute("call-1", {}, undefined, undefined, ctx);

		expect(result.structuredContent.missing).toBeGreaterThan(0);
		expect(result.content[0].text).toContain("worktree");
		expect(result.details.headline).toContain("doctor:");
		const rewind = result.structuredContent.extensions.find(
			(entry: { extension: string }) => entry.extension === "rewind",
		);
		expect(rewind.findings.some((finding: { hint?: string }) => finding.hint?.includes("install git"))).toBe(true);
	});

	test("renders a host-rejected call from its message", () => {
		const { fake } = bootDoctor();
		const tool = fake.tools.get("run_doctor");
		const text = tool
			.renderResult(
				{
					content: [{ type: "text", text: 'Validation failed for tool "run_doctor"' }],
					details: {},
					isError: true,
				},
				{ expanded: false },
				fakeTheme,
				{ lastComponent: undefined },
			)
			.render(80)
			.join("\n");
		expect(text).toContain("Validation failed for tool");
	});

	test("reports one extension when asked", async () => {
		const { fake, ctx } = bootDoctor();
		const tool = fake.tools.get("run_doctor");
		const result = await tool.execute("call-1", { extension: "todo" }, undefined, undefined, ctx);
		expect(result.structuredContent.extensions).toHaveLength(1);
		expect(result.structuredContent.extensions[0].extension).toBe("todo");
	});

	test("names the known extensions when asked for an unknown one", async () => {
		const { fake, ctx } = bootDoctor();
		const tool = fake.tools.get("run_doctor");
		await expect(tool.execute("call-1", { extension: "nope" }, undefined, undefined, ctx)).rejects.toThrow(
			/No extension named "nope"\. Known extensions: /,
		);
	});
});
