/**
 * The write gate as one table: what a session holding each lane may do.
 *
 * The capability is the card's lane, not the session's mode, so every case here is a card and a
 * call and nothing else — no board on disk, no `tool_call` handler, no plan mode. What the handler
 * adds (the seat's reason first, the stand-down while planning, the cache) is
 * `extension.test.ts`'s half; this is the rule itself.
 *
 * The refusals are asserted as sentences rather than fragments, because they are a surface: each
 * names the card, the lane, and the one door out, and a narrower assertion would pass while the
 * route went missing.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { LEAD_MODE_ENTRY_TYPE, PLAN_MODE_ENTRY_TYPE } from "../../lib/mode-state.ts";
import { JOB_TOOL, WATCH_TOOL } from "../../lib/tool-names.ts";
import type { Card } from "../../lib/workflow/card.ts";
import { cardFile, guardedBoard } from "../../test/helpers/board.ts";
import { tempDir, withEnv } from "../../test/helpers/env.ts";
import { boardCard } from "../../test/helpers/fixtures/board.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { writeRefusal } from "./write-gate.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** A worktree for the paths to resolve against; nothing has to exist inside it. */
const ROOT = temps.track(tempDir("pi-write-gate-"));

/** A contract, so a card can be past its planning and still owe the lead's approval. */
const CONTRACT = { goal: "g", acceptance: "a", scopeOut: "s", verify: "bun run check" };

/** A plan-lane card, unapproved: the state plan mode leaves when it hands write access back. */
function planned(overrides: Partial<Card> = {}): Card {
	return boardCard("928", { lane: "plan", paths: ["extensions/board/write-gate.ts"], ...overrides });
}

/** The same card with its contract signed, so only the move is missing. */
function signedPlan(overrides: Partial<Card> = {}): Card {
	return planned({ contract: { ...CONTRACT, approved: { by: "gavin", at: 1 } }, ...overrides });
}

/** An execute card that names its paths. */
function inExecute(overrides: Partial<Card> = {}): Card {
	return planned({ lane: "execute", ...overrides });
}

/** The gate with a pinning subagent probe, as the board's handler supplies it. */
function gate(
	held: readonly Card[],
	tool: string,
	input: unknown,
	probe: (input: unknown) => string | undefined = pin,
) {
	return writeRefusal(held, { tool, input }, { root: ROOT, pinSubagent: probe });
}

/** A probe that honours the pin, the way a `subagent` tool that declares the parameter does. */
function pin(input: unknown): string | undefined {
	if (typeof input === "object" && input !== null) (input as Record<string, unknown>).readOnly = true;
	return undefined;
}

describe("a session with no card in flight", () => {
	test("writes freely, and a finished card is not a leash", () => {
		expect(gate([], "write", { path: "anywhere.ts" })).toBeUndefined();
		expect(gate([], "bash", { command: "bun run check" })).toBeUndefined();
		expect(gate([boardCard("7", { lane: "done" })], "edit", { path: "anywhere.ts" })).toBeUndefined();
	});

	test("is judged by nothing else: readers and the board's own verbs pass", () => {
		const held = [planned()];
		expect(gate(held, "read", { path: "lib/workflow/card.ts" })).toBeUndefined();
		expect(gate(held, "grep", { pattern: "lane" })).toBeUndefined();
		expect(gate(held, "board", { action: "move", card: "928", lane: "execute" })).toBeUndefined();
		expect(gate(held, "session", { action: "claim", paths: "a.ts" })).toBeUndefined();
		expect(gate(held, "todo", { items: [] })).toBeUndefined();
	});
});

describe("a card on its way to execute", () => {
	test("refuses a file write, and names the contract and the move", () => {
		expect(gate([planned()], "write", { path: "extensions/board/write-gate.ts" })).toBe(
			"board: #928 is in plan; a file write needs the card in execute. Record it with `contract`. Approval clears it. Or `board release 928` to work without it.",
		);
	});

	test("offers only the move once the contract is signed", () => {
		expect(gate([signedPlan()], "edit", { path: "extensions/board/write-gate.ts" })).toBe(
			"board: #928 is in plan; a file write needs the card in execute. `board move 928 execute` clears it. Or `board release 928` to work without it.",
		);
	});

	test("judges a blocked card by what its contract still owes", () => {
		const blocked = planned({ lane: "blocked", blocked: { kind: "decision", note: "a ruling" } });
		expect(gate([blocked], "write", { path: "a.ts" })).toContain(
			"board: #928 is in blocked; a file write needs the card in execute.",
		);
		expect(gate([blocked], "write", { path: "a.ts" })).toContain(
			"Move it back to plan, then record it with `contract`.",
		);
	});

	test("refuses every shell it cannot judge read-only", () => {
		expect(gate([planned()], "bash", { command: "bun test" })).toContain("board: ");
		expect(gate([signedPlan()], "bash", { command: "bun test" })).toContain("`board move 928 execute` clears it");
		expect(gate([planned()], "bash", { command: "bun test" })).toContain("Record it with `contract`.");
		expect(gate([planned()], "bash", { command: "" })).toContain("board: An empty bash command is not allowed.");
		expect(gate([planned()], "powershell", { command: "Get-ChildItem" })).toContain(
			"board: #928 is in plan; a PowerShell command needs the card in execute.",
		);
	});

	test("reads a repository with git in any lane, and writes the approved command back", () => {
		const call = { command: "git log --oneline -3" };
		expect(gate([planned()], "bash", call)).toBeUndefined();
		// The guard's own switches are what runs, so the call is no longer what the model wrote.
		expect(call.command).toContain("--oneline -3");
		expect(call.command).toContain("--no-ext-diff");
		const chained = { command: "git status && git log -1" };
		expect(gate([planned()], "bash", chained)).toBeUndefined();
	});
});

describe("an execute card is the boundary", () => {
	test("allows a write to the very file a hint names, which is the ordinary card", () => {
		const card = inExecute({ paths: ["extensions/board/schema.ts"] });
		expect(gate([card], "write", { path: "extensions/board/schema.ts" })).toBeUndefined();
		expect(gate([card], "edit", { path: join(ROOT, "extensions/board/schema.ts") })).toBeUndefined();
		// The hint is inclusive, so the same card's other files are still refused.
		expect(gate([card], "write", { path: "extensions/board/write-gate.ts" })).toContain("is outside them");
	});

	test("a directory hint covers what is written under it", () => {
		const held = [inExecute({ paths: ["extensions/board"] })];
		expect(gate(held, "write", { path: "extensions/board/write-gate.ts" })).toBeUndefined();
		expect(gate(held, "write", { path: "lib/policy.ts" })).toBe(
			"board: #928 in execute names `extensions/board`; lib/policy.ts is outside them — `board edit 928 paths [...]` adds it.",
		);
	});

	test("a card that names no paths scopes nothing", () => {
		expect(gate([inExecute({ paths: [] })], "write", { path: "lib/workflow/card.ts" })).toBeUndefined();
	});

	test("refuses a path outside the worktree, where no hint can reach", () => {
		expect(gate([inExecute()], "write", { path: "../elsewhere.ts" })).toBe(
			"board: ../elsewhere.ts is outside the worktree, so no card's paths can name it.",
		);
		expect(isAbsolute("../elsewhere.ts")).toBe(false);
	});

	test("leaves the shell to the lane, because its effect is not decidable", () => {
		expect(gate([inExecute()], "bash", { command: "bun test extensions/board" })).toBeUndefined();
		expect(gate([inExecute()], "powershell", { command: "Get-ChildItem" })).toBeUndefined();
	});
});

describe("a delegated child", () => {
	test("is pinned read-only while the card is outside execute", () => {
		const call = { prompt: "read the file" };
		expect(gate([planned()], "subagent", call)).toBeUndefined();
		expect((call as Record<string, unknown>).readOnly).toBe(true);
	});

	test("is refused when the tool cannot be pinned, and the lane names the way out", () => {
		const refused = gate(
			[planned()],
			"subagent",
			{},
			() =>
				'the registered "subagent" tool does not support read-only delegation; explore with the structured tools instead.',
		);
		expect(refused).toBe(
			'board: #928 is in plan; the registered "subagent" tool does not support read-only delegation; explore with the structured tools instead. Record it with `contract`. Approval clears it. Or `board release 928` to work without it.',
		);
	});

	test("is free to write under an execute card", () => {
		const call = { prompt: "change the file" };
		expect(gate([inExecute()], "subagent", call)).toBeUndefined();
		expect((call as Record<string, unknown>).readOnly).toBeUndefined();
	});
});

describe("a tool that runs what it is told", () => {
	test("refuses the actions that run a command, and allows the reads and the cleanups", () => {
		const held = [planned()];
		// Named here rather than read off `ACTION_JUDGED`: the record is the decision this case exists to
		// hold, so a reclassification that made `start` a read has to redden here before it can pass a walk.
		for (const action of ["start", "send"]) {
			expect(gate(held, JOB_TOOL, { action })).toContain("a background command needs the card in execute");
		}
		expect(gate(held, WATCH_TOOL, { action: "add" })).toContain("a watcher needs the card in execute");
		for (const action of ["list", "status", "logs", "wait", "kill", "clear"]) {
			expect(gate(held, JOB_TOOL, { action })).toBeUndefined();
		}
		for (const action of ["list", "status", "matches", "logs", "stop", "clear"]) {
			expect(gate(held, WATCH_TOOL, { action })).toBeUndefined();
		}
	});

	test("fails closed on a call it cannot classify", () => {
		// A missing action is not bookkeeping, and neither is a verb the record never names: the lane
		// has the answer, and the tool's own schema refuses the call a moment later.
		expect(gate([planned()], JOB_TOOL, {})).toContain("a background command needs the card in execute");
		expect(gate([planned()], WATCH_TOOL, { action: 7 })).toContain("a watcher needs the card in execute");
		expect(gate([planned()], JOB_TOOL, { action: "explode" })).toContain(
			"a background command needs the card in execute",
		);
	});

	test("is allowed under an execute card, where the work is", () => {
		for (const action of ["start", "send"]) expect(gate([inExecute()], JOB_TOOL, { action })).toBeUndefined();
		expect(gate([inExecute()], WATCH_TOOL, { action: "add" })).toBeUndefined();
	});
});

/** The board's factory enabled, as the host loads it. */
const ENABLED = { [ENV_DISABLED_EXTENSIONS]: "" };

/** The shared factory fixture, with this suite's temp tracker, so its directories are cleaned up. */
const boardAt = (options: { branch?: unknown[] } = {}) => guardedBoard({ track: temps.track, ...options });

/** Where the card lands next, written straight to its file: the lanes' gates are not this suite's. */
function relane(next: Awaited<ReturnType<typeof boardAt>>, lane: Card["lane"]): void {
	const file = cardFile(next.harness.agentDir, next.card.id);
	const record = JSON.parse(readFileSync(file, "utf8")) as Card;
	writeFileSync(file, JSON.stringify({ ...record, lane }));
}

describe("the handler the model meets", () => {
	test("refuses a write for a card still in plan, and allows it once the card is in execute", async () => {
		await withEnv(ENABLED, async () => {
			const next = await boardAt();
			const refused = await next.call("write", { path: "extensions/board/write-gate.ts" });
			expect(refused?.block).toBe(true);
			expect(refused?.reason).toContain(`#${next.card.id} is in plan`);
			expect(refused?.reason).toContain("Record it with `contract`.");

			relane(next, "execute");
			// The board call is what tells the gate the set moved: one scan per turn, cleared by a
			// call that writes cards — including this read, which costs one scan rather than a stale lane.
			expect(await next.call("board", { action: "list" })).toBeUndefined();
			expect(await next.call("write", { path: "extensions/board/write-gate.ts" })).toBeUndefined();
			expect((await next.call("write", { path: "lib/policy.ts" }))?.block).toBe(true);
		});
	});

	test("reads the lanes once, so a move it has not been told about is the next turn's answer", async () => {
		await withEnv(ENABLED, async () => {
			const next = await boardAt();
			expect((await next.call("write", { path: "a.ts" }))?.block).toBe(true);
			relane(next, "execute");
			// The same turn, after a move nobody reported: the cached lane still refuses. Cheap, and a
			// stale allow is the failure this cache must never make.
			expect((await next.call("write", { path: "extensions/board/write-gate.ts" }))?.block).toBe(true);
		});
	});

	test("lets a released card go, because the session holds nothing", async () => {
		await withEnv(ENABLED, async () => {
			const next = await boardAt();
			const store = await next.harness.runtime.store(next.harness.cwd);
			const me = await next.harness.runtime.who(next.harness.ctx, next.harness.cwd);
			await store.mutate(next.card.id, { kind: "release" }, me, next.harness.now);
			expect(await next.call("write", { path: "a.ts" })).toBeUndefined();
		});
	});

	test("stands down while plan mode will say it first, so one call gets one sentence", async () => {
		await withEnv(ENABLED, async () => {
			const planning = await boardAt({
				branch: [{ type: "custom", customType: PLAN_MODE_ENTRY_TYPE, data: { enabled: true } }],
			});
			expect(await planning.call("write", { path: "extensions/board/write-gate.ts" })).toBeUndefined();
		});
	});

	test("answers the seat's sentence first, because the seat holds no card", async () => {
		await withEnv(ENABLED, async () => {
			const seated = await boardAt({
				branch: [{ type: "custom", customType: LEAD_MODE_ENTRY_TYPE, data: { enabled: true } }],
			});
			seated.harness.runtime.serve("team-lead");
			const refused = await seated.call("write", { path: "extensions/board/write-gate.ts" });
			expect(refused?.reason).toContain("Lead mode holds the seat");
			expect(refused?.reason).not.toContain("is in plan");
		});
	});
});
