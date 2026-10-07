import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import checkpoint from "../../extensions/checkpoint/index.ts";
import { cleanup, makeCtx, makeFakePi, makeRepo } from "./helpers.ts";

const cleanups: string[] = [];
afterAll(() => cleanup(...cleanups));

function setup() {
	const fake = makeFakePi();
	checkpoint(fake.pi);
	return fake;
}

describe("checkpoint tool", () => {
	test("is registered non-destructive and sequential", () => {
		const tool = setup().tools.get("checkpoint");
		expect(tool.annotations.destructiveHint).toBe(false);
		expect(tool.annotations.readOnlyHint).toBe(false);
		expect(tool.executionMode).toBe("sequential");
	});

	test("saves a labeled snapshot and updates the chip", async () => {
		const repo = await makeRepo("pi-cp-tools-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo });
		writeFileSync(join(repo, "a.txt"), "one\n");

		const result = await fake.tools.get("checkpoint").execute("id", { label: "first" }, undefined, undefined, ctx);
		expect(result.details.checkpoint.label).toBe("first");
		expect(result.details.checkpoint.reason).toBe("manual");
		expect(result.details.checkpoint.prompt).toBeUndefined();
		expect(ctx.statuses.get("checkpoint")).toBe("⟲1");
	});

	test("rejects an over-long label as an error result", async () => {
		const repo = await makeRepo("pi-cp-tools-label-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo });
		const result = await fake.tools
			.get("checkpoint")
			.execute("id", { label: "x".repeat(200) }, undefined, undefined, ctx);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("label is longer");
	});

	test("errors outside a git repository", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-cp-nogit-"));
		cleanups.push(dir);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: dir });
		const result = await fake.tools.get("checkpoint").execute("id", {}, undefined, undefined, ctx);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("git repository");
	});
});
