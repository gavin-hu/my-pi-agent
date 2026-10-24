/**
 * The plan-with-a-team workflow, end to end.
 *
 * Every other suite proves one side of the `## Team` format against its own copy:
 * plan's tools assert the text approval wrote, and the bus's suites read a
 * hand-written fixture. This is the only place where the writer's output is the
 * reader's input — approval writes the table into the plan store, and the bus
 * reads that same file to claim a unit's paths — so a change to the section's
 * shape, to a unit's paths, or to where the store lives fails here instead of in
 * the field, where it looks like a session that cannot join.
 *
 * The two sessions are real bus runtimes over one agent directory. Git is a seam,
 * because what is under test is the file the two extensions share, not git.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { readSplit } from "../lib/plans/split.ts";
import { plansDir } from "../lib/plans/store.ts";
import { repoKeyOf } from "../lib/repo-key.ts";
import { createPlanPolicy } from "../extensions/plan/policy.ts";
import { createPlanRuntime, ENTER_TOOL, EXIT_TOOL, WRITE_PLAN_TOOL } from "../extensions/plan/runtime.ts";
import { registerTools } from "../extensions/plan/tools.ts";
import { createSessionBus, type SessionBus } from "../extensions/session-bus/runtime.ts";
import { resolveUnit } from "../extensions/session-bus/team.ts";
import { tempDir, useEnv } from "./helpers/env.ts";
import type { ExecResult } from "./helpers/git.ts";
import { fakeCtx, makeFakePi } from "./helpers/fixtures/plan.ts";

/** The git seam: every call answers with the repository's own path. */
type SeamExec = (command: string, args: string[]) => Promise<Omit<ExecResult, "killed">>;

/** A git that reports `root` as both the worktree and its common dir. */
const gitAt =
	(root: string): SeamExec =>
	async () => ({ stdout: `${root}\n`, stderr: "", code: 0 });

const AGENT = tempDir("pi-team-flow-agent-");
let scoped: { restore: () => void } | undefined;

beforeEach(() => {
	scoped = useEnv({ PI_CODING_AGENT_DIR: AGENT });
	// The switch a project turns on for itself, which is what lets a plan be split.
	writeFileSync(join(AGENT, "bytefly.json"), JSON.stringify({ plan: { team: true } }));
});
afterEach(() => {
	scoped?.restore();
	scoped = undefined;
});
afterAll(() => {
	rmSync(AGENT, { recursive: true, force: true });
});

const PLAN = [
	"# Rate limiting",
	"",
	"## Goal",
	"",
	"Cap a caller's request rate, split so one session owns the contract and another the caller.",
	"",
	"## Steps",
	"",
	"- [ ] contract: `label()` in src/contract, with a test",
	"- [ ] core: greet through it, with a test",
	"",
	"## Verification",
	"",
	"```bash",
	"bun test src/contract",
	"bun test src/core",
	"```",
].join("\n");

const CONTRACT = { name: "contract", paths: ["src/contract"], test: "bun test src/contract", lead: true };
const CORE = { name: "core", paths: ["src/core"], test: "bun test src/core", dependsOn: ["contract"] };

const call = (tool: any, params: unknown, ctx: any) => tool.execute("call-1", params, undefined, undefined, ctx);

describe("a plan approved as a team, then joined", () => {
	test("the table approval writes is the table the bus claims from", async () => {
		const root = realpathSync.native(mkdtempSync(join(tmpdir(), "pi-team-flow-repo-")));
		const fake = makeFakePi({
			active: ["read", "bash", "write", "edit", ENTER_TOOL, "todo"],
			exec: gitAt(root),
		});
		const runtime = createPlanRuntime(fake.pi, createPlanPolicy(fake.pi));
		registerTools(fake.pi, runtime);

		// Plan mode, then the plan itself: the gate is the only writer of the section.
		await call(fake.tools.get(ENTER_TOOL), {}, fakeCtx({ confirm: true, cwd: root }).ctx);
		expect(runtime.isEnabled()).toBe(true);
		const written = await call(
			fake.tools.get(WRITE_PLAN_TOOL),
			{ title: "Rate limiting", content: PLAN },
			fakeCtx({ cwd: root }).ctx,
		);
		const planPath = (written.details as { path: string }).path;

		const approved = await call(
			fake.tools.get(EXIT_TOOL),
			{ plan_path: planPath, units: [CONTRACT, CORE] },
			fakeCtx({ editor: "1", cwd: root }).ctx,
		);
		expect(approved.details.approved).toBe(true);
		expect(approved.details.team).toMatchObject({ lead: "contract", verdict: "pair" });
		expect(approved.content[0].text).toContain("start after: contract");

		// The seam: the file approval wrote, read back by the module the bus uses.
		const plans = plansDir(AGENT, repoKeyOf(root));
		const team = basename(planPath, ".md");
		expect(readSplit(readFileSync(planPath, "utf-8"))).toEqual({
			lead: "contract",
			units: [
				{ name: "contract", paths: ["src/contract"], test: "bun test src/contract", dependsOn: [], lead: true },
				{ name: "core", paths: ["src/core"], test: "bun test src/core", dependsOn: ["contract"] },
			],
		});
		expect(resolveUnit(plans, { team, unit: "core" })).toEqual({ team, name: "core", paths: ["src/core"] });

		// Two sessions on one bus, each named the way the roster card asks.
		const busDir = tempDir("pi-team-flow-bus-");
		const busFor = (): SessionBus =>
			createSessionBus(fake.pi, {
				dir: busDir,
				repo: { root, key: repoKeyOf(root) },
				plans,
				now: () => 1_000,
				heartbeatMs: 0,
				watchMs: 0,
			});
		// Reading the bus is not joining it, so the first addressable action is what
		// puts a named session on it — the same path a pane walks.
		const joining = async (bus: SessionBus, id: string, label: string): Promise<void> => {
			await bus.start(fakeCtx({ cwd: root, sessionId: id, sessionName: label }).ctx);
			await bus.watch({ stop: true });
		};
		const owner = busFor();
		const lead = busFor();
		await joining(owner, "s-core", "core");
		await joining(lead, "s-contract", "contract");

		expect(await owner.join({ team, unit: "core" })).toMatchObject({ claimed: ["src/core"], conflicts: [] });
		// From the roster card to a claim: the unit's paths are the ones it owns.
		expect((await owner.status()).units).toMatchObject({ joined: 1, total: 2 });

		// The shared-file rule, from the unit the session actually holds.
		await expect(owner.claim(["CHANGELOG.md"])).rejects.toThrow('only the lead "contract" may claim it');
		expect(await lead.join({ team, unit: "contract" })).toMatchObject({ claimed: ["src/contract"] });
		expect((await lead.claim(["package.json"])).claimed).toEqual(["package.json"]);
		expect((await owner.status()).units).toMatchObject({ joined: 2, total: 2 });

		// Leaving returns the unit, and with it the rule.
		expect((await owner.leave({})).released).toEqual(["src/core"]);
		expect((await owner.status()).units).toMatchObject({ joined: 1, total: 2 });
		expect((await owner.claim(["CHANGELOG.md"])).claimed).toEqual(["CHANGELOG.md"]);

		await owner.stop();
		await lead.stop();
		rmSync(root, { recursive: true, force: true });
	});
});
