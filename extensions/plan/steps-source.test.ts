/**
 * Where the step list came from, said where the decision is made.
 *
 * A plan without a `Steps` heading feeds its shallowest list as steps, so an approval can
 * seed Context and Risks bullets nobody meant to track. The parser's fallback is deliberate
 * and stays; these cases are the three surfaces that have to say which list was taken —
 * the saved result, the over-cap refusal before a write, and the over-cap refusal at
 * `exit`, where the file is one nobody watched being written.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useEnv } from "../../test/helpers/env.ts";
import { makePlanPi, planAct as act, planCtx, planEnter as enter, planExec } from "../../test/helpers/fixtures/plan.ts";
import { stepsSourceNote } from "./format.ts";
import { createPlanPolicy } from "./policy.ts";
import { createPlanRuntime, PLAN_TOOL } from "./runtime.ts";
import { registerTools } from "./tools.ts";

/** One agent directory for this file: plans land outside the project. */
const AGENT = mkdtempSync(join(tmpdir(), "pi-plan-source-agent-"));
let scoped: { restore: () => void } | undefined;
let root = "";
beforeEach(() => {
	scoped = useEnv({ PI_CODING_AGENT_DIR: AGENT });
	root = mkdtempSync(join(tmpdir(), "pi-plan-source-"));
});
afterEach(() => {
	scoped?.restore();
	scoped = undefined;
	rmSync(root, { recursive: true, force: true });
});
afterAll(() => {
	rmSync(AGENT, { recursive: true, force: true });
});

/** A plan tool registered the way the extension registers it. */
function harness() {
	const fake = makePlanPi({ active: ["read", PLAN_TOOL], allTools: [], exec: planExec(root) });
	const runtime = createPlanRuntime(fake.pi, createPlanPolicy(fake.pi));
	registerTools(fake.pi, runtime);
	return { runtime, plan: fake.tools.get(PLAN_TOOL) };
}

/** `count` top-level bullets in a document that has no `Steps` heading. */
function bullets(count: number): string {
	const lines = ["# T", "", "## Risks"];
	for (let index = 1; index <= count; index += 1) lines.push(`- risk ${index}`);
	return lines.join("\n");
}

const NO_HEADING = "No `Steps` heading was found";

describe("the note itself", () => {
	test("says nothing when the steps came from a Steps section", () => {
		expect(stepsSourceNote(true, 4)).toBe("");
	});

	test("names the list it took, and says one bullet for one", () => {
		expect(stepsSourceNote(false, 1)).toContain("its shallowest list, 1 bullet");
		expect(stepsSourceNote(false, 1)).not.toContain("1 bullets");
		expect(stepsSourceNote(false, 3)).toContain("its shallowest list, 3 bullets");
	});
});

describe("a saved plan with no Steps heading", () => {
	test("reports the heading it did not find and how many bullets it counted", async () => {
		const { plan, runtime } = harness();
		await enter(plan, runtime, root);

		const result = await act(plan, "write", { title: "T", content: bullets(3) }, planCtx({ cwd: root }).ctx);

		expect(result.isError).toBeUndefined();
		const text = result.content[0].text;
		expect(text).toContain(NO_HEADING);
		expect(text).toContain("3 bullets, Context and Risks bullets included");
	});

	test("says nothing extra when the plan has a Steps section", async () => {
		const { plan, runtime } = harness();
		await enter(plan, runtime, root);

		const result = await act(
			plan,
			"write",
			{ title: "T", content: "# T\n\n## Steps\n- one\n- two" },
			planCtx({ cwd: root }).ctx,
		);

		expect(result.isError).toBeUndefined();
		expect(result.content[0].text).not.toContain(NO_HEADING);
	});
});

describe("an over-cap plan", () => {
	test("is refused with the source named, and nothing is written", async () => {
		const { plan, runtime } = harness();
		await enter(plan, runtime, root);

		const result = await act(plan, "write", { title: "T", content: bullets(51) }, planCtx({ cwd: root }).ctx);

		expect(result.isError).toBe(true);
		expect(result.details.refused).toBe("write");
		expect(result.content[0].text).toContain("51 top-level steps");
		expect(result.content[0].text).toContain("51 bullets, Context and Risks bullets included");
		// The refusal is before the write, so the store still holds no plan.
		const dir = await runtime.plans.dirFor(root);
		expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
	});

	test("says the same at exit for a file hand-edited into the fallback, opening no screen", async () => {
		const { plan, runtime } = harness();
		await enter(plan, runtime, root);
		const saved = await act(
			plan,
			"write",
			{ title: "T", content: "# T\n\n## Steps\n- one" },
			planCtx({ cwd: root }).ctx,
		);
		const path = (saved.details as { path: string }).path;
		// The heading removed and the document grown past the cap: `write` would have
		// refused this, so no save ever reported it.
		writeFileSync(path, bullets(51));

		const { ctx, customCalls } = planCtx({ mode: "tui", custom: { action: "approve" }, cwd: root });
		const result = await act(plan, "exit", { plan_path: path }, ctx);

		expect(result.isError).toBe(true);
		expect(result.details.approved).toBe(false);
		expect(result.content[0].text).toContain("51 top-level steps");
		expect(result.content[0].text).toContain("51 bullets, Context and Risks bullets included");
		expect(customCalls).toEqual([]);
	});
});
