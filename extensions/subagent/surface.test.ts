/**
 * The surface across two sessions in one process.
 *
 * The runtime is built once and reset per `session_start`; a reset empties the runtime's
 * listener set, so the surface has to install its chip subscription again or the count
 * stops updating for the rest of the process. The case here is the second session's first
 * background run — the shape that used to go silent.
 */

import { describe, expect, test } from "bun:test";
import { BUILTIN_AGENTS } from "./agents.ts";
import { createBackgroundSurface } from "./surface.ts";
import { createResult } from "./stream.ts";
import type { RunOptions } from "./run.ts";
import type { SingleResult } from "./types.ts";
import { STATUS_KEYS } from "../../lib/tui/glyphs.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { makeFakePi } from "../../test/helpers/fakes.ts";
import { settle } from "../../test/helpers/process.ts";

/** A run that settles only when the case resolves it. */
function deferredRun() {
	let resolve: ((result: SingleResult) => void) | undefined;
	const run = (_options: RunOptions): Promise<SingleResult> =>
		new Promise<SingleResult>((settle) => {
			resolve = settle;
		});
	return { run, finish: () => resolve?.({ ...createResult("explorer", "t"), exitCode: 0, finishedAt: 2_000 }) };
}

const deps = (run: (options: RunOptions) => Promise<SingleResult>) => ({
	run,
	agents: BUILTIN_AGENTS,
	defaults: {},
	defaultCwd: "/repo",
	timeoutMs: 0,
	backgroundMax: 4,
});

/** Start one background run and let the microtask that spawns it land. */
async function startRun(
	surface: ReturnType<typeof createBackgroundSurface>,
	ctx: ReturnType<typeof fakeCtx>["ctx"],
	run: (options: RunOptions) => Promise<SingleResult>,
): Promise<void> {
	await surface.startRun({ agent: "explorer", task: "t" }, ctx.sessionManager.getBranch(), deps(run), ctx);
	await settle();
}

describe("the background surface", () => {
	test("keeps painting the chip after a session switch", async () => {
		const fake = makeFakePi();
		const surface = createBackgroundSurface(fake.pi);
		const first = fakeCtx({ sessionId: "s1" });
		const second = fakeCtx({ sessionId: "s2" });

		surface.start(first.ctx);
		const one = deferredRun();
		await startRun(surface, first.ctx, one.run);
		expect(first.statuses.get(STATUS_KEYS.agents)).toContain("1");

		// A second session_start on the same surface, with no shutdown in between: Pi's own
		// rebuild makes that unusual, but `start`'s contract is exactly this re-attach.
		one.finish();
		await settle();
		surface.start(second.ctx);
		// A reset drops the runtime's listeners; the surface must subscribe again, or this
		// run's count never reaches the footer.
		await startRun(surface, second.ctx, deferredRun().run);
		expect(second.statuses.get(STATUS_KEYS.agents)).toContain("1");
	});
});
