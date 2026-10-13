import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { withAgentDir, withEnv } from "../../test/helpers/env.ts";
import { bootDoctor, failingExec } from "../../test/helpers/fixtures/doctor.ts";

describe("doctor wiring", () => {
	test("registers a read-only tool and the command", () => {
		const { fake } = bootDoctor();
		const tool = fake.tools.get("run_doctor");
		expect(tool).toBeDefined();
		expect(tool.annotations.readOnlyHint).toBe(true);
		expect(tool.annotations.destructiveHint).toBe(false);
		expect(tool.outputSchema).toBeDefined();
		expect(fake.commands.has("doctor")).toBe(true);
	});

	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ PI_DISABLED_EXTENSIONS: "doctor" }, () => {
			const { fake } = bootDoctor();
			expect(fake.tools.size).toBe(0);
			expect(fake.commands.size).toBe(0);
		});
	});
});

describe("proactive probe", () => {
	test("warns once when an enabled extension is missing a hard requirement", async () => {
		const { start, notices } = bootDoctor({ exec: failingExec });
		await start();
		expect(notices).toHaveLength(1);
		expect(notices[0]?.kind).toBe("warning");
		expect(notices[0]?.message).toContain("worktree");
		expect(notices[0]?.message).toContain("run /doctor");
	});

	test("stays quiet when every hard requirement is met", async () => {
		const { start, notices } = bootDoctor();
		await start();
		expect(notices).toEqual([]);
	});

	test("stays quiet when proactive checks are disabled", async () => {
		await withAgentDir(async (dir) => {
			writeFileSync(join(dir, "doctor.json"), JSON.stringify({ proactive: false }));
			const { start, notices } = bootDoctor({ exec: failingExec });
			await start();
			expect(notices).toEqual([]);
		});
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
