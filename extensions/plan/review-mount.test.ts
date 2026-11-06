/**
 * Where a browser page's prefix comes from.
 *
 * A page binds no socket of its own: it asks `serve` for a prefix on the session's one
 * server, and the spec it asks with carries the Pi session's id. `serve` keys the socket,
 * the remembered port, and the pin by that id, and draws the port chip in the context it
 * filed with it, so an id the session did not give it is a port nobody names.
 *
 * The shipped door — `/plan list`'s Enter, which opens the read-only view — is driven with
 * the mount substituted: the refusal stops the start before it would bind a socket or open
 * a browser.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import planMode from "./index.ts";
import { createPlanStore } from "./plans.ts";
import { PLAN_TOOL } from "./runtime.ts";
import type { MountSpec } from "../../lib/http/mount.ts";
import { withAgentDir } from "../../test/helpers/env.ts";
import { emitCollect as emit } from "../../test/helpers/fakes.ts";
import { makePlanPi, planCtx } from "../../test/helpers/fixtures/plan.ts";

describe("the review's mount", () => {
	test("asks for its prefix under the session's own id", async () => {
		await withAgentDir(async () => {
			const fakePi = makePlanPi({ active: ["read", PLAN_TOOL] });
			const { ctx } = planCtx({ cwd: "/repo", sessionId: "sess-review", mode: "tui" });
			const dir = await createPlanStore(fakePi.pi).dirFor(ctx.cwd);
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "2026-10-08-1530-demo.md"), "# Plan\n\n## Steps\n- [ ] one\n");
			const specs: MountSpec[] = [];
			planMode(fakePi.pi, {
				mount: async (spec) => {
					specs.push(spec);
					return { kind: "refused", reason: "no server in a test" };
				},
			});
			await emit(fakePi.pi, "session_start", { reason: "startup" }, ctx);
			// The list's Enter selects the plan, which is what opens the view.
			ctx.ui.custom = async (
				factory: (tui: unknown, theme: unknown, keys: unknown, done: () => void) => { handleInput(data: string): void },
			) => {
				const component = factory(
					{ requestRender: () => {}, terminal: { rows: 24, columns: 80 } },
					ctx.ui.theme,
					{},
					() => {},
				);
				component.handleInput("\r");
				return undefined;
			};

			await fakePi.commands.get("plan").handler("list", ctx);

			expect(specs.map((spec) => spec.session)).toEqual(["sess-review"]);
		});
	});
});
