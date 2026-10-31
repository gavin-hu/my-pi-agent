/**
 * The folded `plan` tool's own surface: one registration, one action field, and
 * the refusals each verb makes on its own terms.
 *
 * The verbs' behaviour is proved in `tools.test.ts` against a real plan store;
 * this suite is the schema, the annotations, and the boundary checks a wrong
 * `action` or a missing field runs into, and it needs no plan file at all.
 */

import { afterAll, beforeEach } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { useEnv } from "../../test/helpers/env.ts";
import { planCtx, makePlanPi } from "../../test/helpers/fixtures/plan.ts";
import { createPlanPolicy } from "./policy.ts";
import { createPlanRuntime, PLAN_ACTIONS, PLAN_TOOL } from "./runtime.ts";
import { registerTools } from "./tools.ts";

const AGENT = mkdtempSync(join(tmpdir(), "pi-plan-registration-agent-"));
let scoped: { restore: () => void } | undefined;
beforeEach(() => {
	scoped = useEnv({ PI_CODING_AGENT_DIR: AGENT });
});
afterAll(() => {
	scoped?.restore();
	rmSync(AGENT, { recursive: true, force: true });
});

/** The registered tool and a context to call it with, on a throwaway checkout. */
function setup() {
	const root = realpathSync.native(mkdtempSync(join(tmpdir(), "pi-plan-registration-")));
	const fake = makePlanPi({ active: ["read", PLAN_TOOL], allTools: [] });
	const runtime = createPlanRuntime(fake.pi, createPlanPolicy(fake.pi));
	registerTools(fake.pi, runtime);
	return { runtime, root, plan: fake.tools.get(PLAN_TOOL), ctx: planCtx({ confirm: true, cwd: root }).ctx };
}

describe("plan tool registration", () => {
	test("registers one sequential, closed-world tool with the strictest annotations", () => {
		const { plan } = setup();
		expect(plan.executionMode).toBe("sequential");
		// One annotation set for five verbs, so it takes the strictest of them: `write`
		// overwrites a plan file with plan_path. The actions that only change the mode
		// are exempted by the guard in `index.ts`, the one place still able to tell them
		// apart.
		expect(plan.annotations).toEqual({
			readOnlyHint: false,
			destructiveHint: true,
			idempotentHint: false,
			openWorldHint: false,
		});
		expect(plan.promptSnippet.length).toBeGreaterThan(0);
	});

	test("offers every planning verb as one action field", () => {
		const { plan } = setup();
		const schemas = (plan.parameters as { properties: Record<string, unknown> }).properties;
		const action = schemas.action as { enum: string[] };
		expect(action.enum).toEqual([...PLAN_ACTIONS]);
		// Every other field is optional and says which action reads it, so one schema
		// covers five verbs without an `anyOf` a provider would have to cope with.
		expect(Object.keys(schemas)).toEqual(["action", "title", "content", "plan_path", "updates"]);
	});

	test("is active in both modes: the plan-mode verbs live inside it", () => {
		const { plan } = setup();
		expect(plan.defaultActive).toBeUndefined();
	});

	test("each action refuses on its own terms, naming the verb it refused", async () => {
		const { plan, ctx } = setup();
		const cases: Array<[string, Record<string, unknown>, string]> = [
			["write", { title: "T", content: "# T" }, "Not in plan mode"],
			["exit", { plan_path: "/x/p.md" }, "no plan to approve"],
			["cancel", {}, "there is nothing to cancel"],
		];
		for (const [action, params, reason] of cases) {
			const result = await plan.execute("call-1", { ...params, action }, undefined, undefined, ctx);
			expect({ action, isError: result.isError, refused: result.details.refused }).toEqual({
				action,
				isError: true,
				refused: action,
			});
			expect(result.content[0].text, action).toContain(reason);
		}
	});

	test("a verb that needs a field says which one, and writes nothing", async () => {
		const { plan, ctx } = setup();
		await plan.execute("call-1", { action: "enter" }, undefined, undefined, ctx);
		const noTitle = await plan.execute("call-1", { action: "write", content: "# T" }, undefined, undefined, ctx);
		expect(noTitle.isError).toBe(true);
		expect(noTitle.content[0].text).toContain("`write` needs a title");
		const noContent = await plan.execute(
			"call-1",
			{ action: "write", title: "T", content: "  " },
			undefined,
			undefined,
			ctx,
		);
		expect(noContent.isError).toBe(true);
		expect(noContent.content[0].text).toContain("`write` needs content");
	});
});
