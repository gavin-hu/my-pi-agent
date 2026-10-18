import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { NOTICE_TYPE } from "../../../lib/notice.ts";
import { withAgentDir } from "../../../test/helpers/env.ts";
import { coloringTheme, fakeTheme } from "../../../test/helpers/fakes.ts";
import { bootDoctor, failingExec } from "../../../test/helpers/fixtures/doctor.ts";

describe("doctor wiring", () => {
	test("registers a read-only tool", () => {
		const { fake } = bootDoctor();
		const tool = fake.tools.get("run_doctor");
		expect(tool).toBeDefined();
		expect(tool.annotations.readOnlyHint).toBe(true);
		// A read-only tool has nothing to be destructive about, so the hint is omitted.
		expect(tool.annotations.destructiveHint).toBeUndefined();
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
	test("posts one transcript notice when an enabled extension is missing a hard requirement", async () => {
		const { fake, start, notices } = bootDoctor({ exec: failingExec, settings: { quietStartup: true } });
		await start();

		// It is a message in the flow, not a transient UI notification.
		expect(notices).toEqual([]);
		expect(fake.customMessages).toHaveLength(1);
		const { message } = fake.customMessages[0] as { message: any };
		expect(message.customType).toBe(NOTICE_TYPE);
		expect(message.display).toBe(true);
		expect(message.content).toContain("run /bytefly doctor");
		expect(message.details.source).toBe("doctor");
		expect(message.details.title).toMatch(/^\d+ missing prerequisites?$/);
		expect(message.details.items).toContainEqual(
			expect.objectContaining({ label: "worktree (git)", detail: expect.stringContaining("install git") }),
		);
	});

	test("stays quiet when every hard requirement is met", async () => {
		const { fake, start, notices } = bootDoctor({ settings: { quietStartup: true } });
		await start();
		expect(notices).toEqual([]);
		expect(fake.customMessages).toEqual([]);
	});

	test("stays quiet when proactive checks are disabled", async () => {
		await withAgentDir(async (dir) => {
			writeFileSync(join(dir, "bytefly.json"), JSON.stringify({ doctor: { proactive: false } }));
			const { fake, start, notices } = bootDoctor({ exec: failingExec, settings: { quietStartup: true } });
			await start();
			expect(notices).toEqual([]);
			expect(fake.customMessages).toEqual([]);
		});
	});

	test("posts the notice when the bytefly startup TUI is on", async () => {
		const { fake, start, notices } = bootDoctor({ exec: failingExec, settings: { quietStartup: true } });
		await start();
		expect(notices).toEqual([]);
		expect(fake.customMessages).toHaveLength(1);
	});

	test("stays quiet for a normal Pi startup", async () => {
		const { fake, start, notices } = bootDoctor({ exec: failingExec, settings: { quietStartup: false } });
		await start();
		expect(notices).toEqual([]);
		expect(fake.customMessages).toEqual([]);
	});

	test("stays quiet when quietStartup only keeps the header", async () => {
		const { fake, start, notices } = bootDoctor({ exec: failingExec, settings: { quietStartup: "header" } });
		await start();
		expect(notices).toEqual([]);
		expect(fake.customMessages).toEqual([]);
	});

	test("stays quiet without a UI to warn", async () => {
		const { fake, start, notices } = bootDoctor({ exec: failingExec, mode: "print", hasUI: false });
		await start();
		expect(notices).toEqual([]);
		expect(fake.customMessages).toEqual([]);
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

	test("returns exactly the fields its output schema declares", async () => {
		const { fake, ctx } = bootDoctor({ exec: failingExec });
		const tool = fake.tools.get("run_doctor");
		const result = await tool.execute("call-1", {}, undefined, undefined, ctx);

		// The schema and the structured result are one contract: a field added to one
		// without the other would leave a caller reading a shape nobody promised.
		const declared = Object.keys(tool.outputSchema.properties as Record<string, unknown>).sort();
		expect(Object.keys(result.structuredContent).sort()).toEqual(declared);

		const severities = tool.outputSchema.properties.extensions.items.properties.findings.items.properties.severity
			.enum as string[];
		const allowed = new Set(severities);
		expect([...allowed].sort()).toEqual(["degraded", "info", "missing", "ok"]);
		for (const report of result.structuredContent.extensions) {
			for (const finding of report.findings) expect(allowed.has(finding.severity)).toBe(true);
		}
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

	test("renders one summary line collapsed and the problems expanded", () => {
		const tool = bootDoctor().fake.tools.get("run_doctor");
		const details = {
			headline: "doctor: 1 missing, 0 degraded across 17 extensions",
			missing: 1,
			degraded: 0,
			extensions: [
				{
					extension: "todo",
					enabled: true,
					findings: [{ check: "node", severity: "missing", detail: "not on PATH", hint: "install node" }],
				},
			],
		};
		const render = (expanded: boolean): string =>
			tool
				.renderResult({ content: [], details }, { expanded }, fakeTheme, { lastComponent: undefined })
				.render(80)
				.join("\n");

		const collapsed = render(false);
		expect(collapsed).toContain("doctor: 1 missing");
		expect(collapsed).not.toContain("not on PATH");
		expect(collapsed.toLowerCase()).toContain("expand");
		expect(render(true)).toContain("not on PATH");
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
