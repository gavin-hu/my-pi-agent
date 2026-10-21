import { afterAll, describe, expect, test } from "bun:test";
import { runSlowSuites } from "../../test/helpers/slow-suite.ts";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT_TOOL_NAMES } from "./root-tools.ts";
import { WORKTREE_TOOLS } from "./tools.ts";
import { execP, makeRepo, makeTempTracker } from "../../test/helpers/git.ts";
import {
	bootWorktree,
	emitEvent,
	makeFakeCtx,
	makeWorktreePi,
	WORKTREE_ENTRY,
} from "../../test/helpers/fixtures/worktree.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { fakeCtx as sharedFakeCtx } from "../../test/helpers/context.ts";
import { tempDir, withEnv } from "../../test/helpers/env.ts";
import { ENV_BRANCH, ENV_MAIN, ENV_ROOT } from "./runtime.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import worktreeExtension from "./index.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** A built-in `bash` owned by another source, used to trigger the override warning. */
function foreignBash() {
	return {
		name: "bash",
		description: "",
		parameters: {},
		promptGuidelines: [],
		exposure: "direct",
		sourceInfo: { path: "builtin:bash", source: "builtin", scope: "global", origin: "top-level" },
	};
}

describe.skipIf(!runSlowSuites)("worktree registration", () => {
	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "worktree" }, () => {
			const { pi, tools, commands, flags, handlers } = createFakePi();
			worktreeExtension(pi);
			expect(tools.size).toBe(0);
			expect(commands.size).toBe(0);
			expect(flags.size).toBe(0);
			expect(handlers.size).toBe(0);
		});
	});

	test("registers a string worktree flag", () => {
		const { pi } = makeWorktreePi();
		expect(pi.flags.get("worktree")?.type).toBe("string");
	});

	test("registers one command and the worktree tools plus root overrides", () => {
		const { pi } = makeWorktreePi();
		expect([...pi.commands.keys()]).toEqual(["worktree"]);
		const expected = [...Object.values(WORKTREE_TOOLS), ...ROOT_TOOL_NAMES].sort();
		expect([...pi.tools.keys()].sort()).toEqual(expected);
	});

	test("builds every root override from the host definition", () => {
		const { builtins } = makeWorktreePi();
		for (const name of ROOT_TOOL_NAMES) {
			expect(builtins.calls.some((call) => call.name === name)).toBe(true);
		}
	});

	test("forwards settings to the host built-in factories", async () => {
		const repo = temps.track(await makeRepo("pi-wt-life-"));
		const settings = { images: { autoResize: false }, shellPath: "/bin/zsh", shellCommandPrefix: "source ~/.zshrc" };
		const harness = await bootWorktree(repo, { flagDefaults: { worktree: "opts" }, settings });
		await harness.run("read");
		await harness.run("bash");
		const read = harness.builtins.calls.filter((call) => call.name === "read").at(-1);
		const bash = harness.builtins.calls.filter((call) => call.name === "bash").at(-1);
		expect(read?.options.read).toEqual({ autoResizeImages: false });
		expect(bash?.options.bash).toEqual({ commandPrefix: "source ~/.zshrc", shellPath: "/bin/zsh" });
	});
});

describe.skipIf(!runSlowSuites)("worktree session lifecycle", () => {
	test("warns at session start when another source owns a root tool", async () => {
		const repo = temps.track(await makeRepo("pi-wt-life-"));
		const { ctx } = await bootWorktree(repo, { allTools: [foreignBash()] });
		expect(ctx.notices.at(-1)).toMatch(/not active for: bash/);
	});

	test("reports inactive overrides through list_worktrees", async () => {
		const repo = temps.track(await makeRepo("pi-wt-life-"));
		const harness = await bootWorktree(repo, { allTools: [foreignBash()] });
		const result = await harness.run(WORKTREE_TOOLS.list);
		expect(result.details.inactiveOverrides).toContain("bash");
		expect(result.content[0].text).toMatch(/not active for: bash/);
	});

	test("does not warn when our own overrides are effective", async () => {
		const repo = temps.track(await makeRepo("pi-wt-life-"));
		const self = ROOT_TOOL_NAMES.map((name) => ({
			name,
			description: "",
			parameters: {},
			promptGuidelines: [],
			exposure: "direct",
			sourceInfo: { path: WORKTREE_ENTRY, source: "extension", scope: "temporary", origin: "top-level" },
		}));
		const { ctx } = await bootWorktree(repo, { allTools: self });
		expect(ctx.notices.some((notice: string) => /not active for/.test(notice))).toBe(false);
	});

	test("enters the worktree named by the startup flag", async () => {
		const repo = temps.track(await makeRepo("pi-wt-life-"));
		const { ctx } = await bootWorktree(repo, { flagDefaults: { worktree: "flagged" } });
		expect(existsSync(join(repo, ".pi", "worktrees", "flagged"))).toBe(true);
		expect(ctx.statuses.get("worktree")).toContain("flagged");
	});

	test("clears the worktree status on shutdown", async () => {
		const repo = temps.track(await makeRepo("pi-wt-life-"));
		const harness = await bootWorktree(repo, { flagDefaults: { worktree: "bye" } });
		expect(harness.ctx.statuses.has("worktree")).toBe(true);
		await emitEvent(harness.pi, "session_shutdown", {}, harness.ctx);
		expect(harness.ctx.statuses.has("worktree")).toBe(false);
	});

	test("re-exports the isolated root when a session restores a worktree", async () => {
		await withEnv({ [ENV_ROOT]: undefined, [ENV_BRANCH]: undefined, [ENV_MAIN]: undefined }, async () => {
			const repo = temps.track(await makeRepo("pi-wt-env-"));
			const harness = await bootWorktree(repo, { flagDefaults: { worktree: "envsync" } });
			const path = join(repo, ".pi", "worktrees", "envsync");
			expect(process.env[ENV_ROOT]).toBe(path);

			// A replacement session in this process must not inherit the old root.
			await emitEvent(harness.pi, "session_shutdown", {}, harness.ctx);
			expect(process.env[ENV_ROOT]).toBeUndefined();

			// Resuming the recorded branch re-exports it.
			const resumed = sharedFakeCtx({ cwd: repo, hasUI: false, mode: "print", branch: harness.pi.entries }).ctx;
			await emitEvent(harness.pi, "session_start", { reason: "resume" }, resumed);
			expect(process.env[ENV_ROOT]).toBe(path);
		});
	});

	test("injects the worktree section before the agent starts", async () => {
		const repo = temps.track(await makeRepo("pi-wt-life-"));
		const harness = await bootWorktree(repo, { flagDefaults: { worktree: "prompted" } });
		const event = { systemPromptOptions: { cwd: "/orig", sections: {} as Record<string, string> } };
		await emitEvent(harness.pi, "before_agent_start", event, harness.ctx);
		expect(event.systemPromptOptions.sections.worktree).toContain(join(repo, ".pi", "worktrees", "prompted"));
	});

	test("re-roots a path-taking tool at call time", async () => {
		const repo = temps.track(await makeRepo("pi-wt-life-"));
		const harness = await bootWorktree(repo, { flagDefaults: { worktree: "rooted" } });
		const result = await harness.pi.tools.get("read").execute("read-1", {}, undefined, undefined, harness.ctx);
		expect(result.content[0].text).toContain(join(repo, ".pi", "worktrees", "rooted"));
	});
});

describe("worktree env sync", () => {
	test("clears a stale PI_WORKTREE_* at session start", async () => {
		await withEnv({ [ENV_ROOT]: "/stale/root", [ENV_BRANCH]: "stale", [ENV_MAIN]: "/stale/main" }, async () => {
			const { pi } = makeWorktreePi();
			const ctx = makeFakeCtx(pi, { cwd: tempDir("pi-wt-env-") });
			await emitEvent(pi, "session_start", { reason: "new" }, ctx);
			expect(process.env[ENV_ROOT]).toBeUndefined();
			expect(process.env[ENV_BRANCH]).toBeUndefined();
			expect(process.env[ENV_MAIN]).toBeUndefined();
		});
	});

	test("clears PI_WORKTREE_* on session shutdown", async () => {
		await withEnv({ [ENV_ROOT]: "/stale/root", [ENV_BRANCH]: "stale", [ENV_MAIN]: "/stale/main" }, async () => {
			const { pi } = makeWorktreePi();
			const ctx = makeFakeCtx(pi, { cwd: tempDir("pi-wt-env-") });
			await emitEvent(pi, "session_shutdown", {}, ctx);
			expect(process.env[ENV_ROOT]).toBeUndefined();
		});
	});
});

describe.skipIf(!runSlowSuites)("worktree isolation gaps", () => {
	/** The status text `list_worktrees` returns, which `/worktree status` also prints. */
	async function statusText(harness: Awaited<ReturnType<typeof bootWorktree>>): Promise<string> {
		const result = await harness.run(WORKTREE_TOOLS.list);
		return result.content[0].text;
	}

	test("names the shell it cannot isolate while the session is isolated", async () => {
		const repo = temps.track(await makeRepo("pi-wt-gaps-"));
		const harness = await bootWorktree(repo, { flagDefaults: { worktree: "gaps" } });

		const text = await statusText(harness);

		expect(text).toContain("Not isolated:");
		expect(text).toContain("! shell");
		expect(text).toContain("unverifiable");
		expect(text).not.toContain("ran this session");
	});

	test("counts a command the guard let through unverified", async () => {
		const repo = temps.track(await makeRepo("pi-wt-gaps-"));
		const harness = await bootWorktree(repo, { flagDefaults: { worktree: "gaps" } });

		await emitEvent(harness.pi, "tool_call", { toolName: "bash", input: { command: "echo $(pwd)" } }, harness.ctx);

		expect(await statusText(harness)).toContain("1 ran this session");
	});

	test("does not count a command it could verify", async () => {
		const repo = temps.track(await makeRepo("pi-wt-gaps-"));
		const harness = await bootWorktree(repo, { flagDefaults: { worktree: "gaps" } });

		await emitEvent(harness.pi, "tool_call", { toolName: "bash", input: { command: "git status" } }, harness.ctx);

		expect(await statusText(harness)).not.toContain("ran this session");
	});

	test("refuses powershell while isolated, and reports the gap when it is allowed", async () => {
		const guardedRepo = temps.track(await makeRepo("pi-wt-pwsh-"));
		const guarded = await bootWorktree(guardedRepo, { flagDefaults: { worktree: "guarded" } });

		// The escape attempt: relative paths in a grammar the bash checks cannot read.
		const refused = await emitEvent(
			guarded.pi,
			"tool_call",
			{ toolName: "powershell", input: { command: "Set-Location ..; git commit -am x" } },
			guarded.ctx,
		);
		expect(refused?.block).toBe(true);
		expect(refused?.reason).toContain("main checkout");
		expect(await statusText(guarded)).not.toContain("powershell");

		// The opt-out runs the tool and becomes a gap the status reports.
		const allowedRepo = temps.track(await makeRepo("pi-wt-pwsh-"));
		mkdirSync(join(allowedRepo, ".pi"), { recursive: true });
		writeFileSync(
			join(allowedRepo, ".pi", "bytefly.json"),
			JSON.stringify({ worktree: { guard: { blockPowershell: false } } }),
		);
		const allowed = await bootWorktree(allowedRepo, { flagDefaults: { worktree: "allowed" } });

		// The tool runs; the row the status adds for it is Windows-only, so it is
		// pinned in `gaps.test.ts` rather than fought for on this platform.
		expect(
			await emitEvent(
				allowed.pi,
				"tool_call",
				{ toolName: "powershell", input: { command: "Get-Location" } },
				allowed.ctx,
			),
		).toBeUndefined();
	});

	test("says nothing about gaps outside a worktree", async () => {
		const repo = temps.track(await makeRepo("pi-wt-gaps-"));
		const harness = await bootWorktree(repo);

		const text = await statusText(harness);

		expect(text).toContain("Not in a worktree.");
		expect(text).not.toContain("Not isolated:");
	});
});

describe.skipIf(!runSlowSuites)("managed worktree status", () => {
	test("keeps every row with its own branch while the rows are gathered together", async () => {
		const repo = temps.track(await makeRepo("pi-wt-rows-"));
		const names = ["alpha", "beta", "gamma"];
		// Created with git directly: a session may sit in one worktree at a time, and
		// the status reads the managed set from git, not from this session's state.
		for (const name of names) {
			await execP("git", ["worktree", "add", "-q", join(repo, ".pi", "worktrees", name), "-b", `worktree-${name}`], {
				cwd: repo,
			});
		}
		// One checkout is dirty, so the marks prove each row was read for its own
		// path rather than for whichever row happened to finish first.
		writeFileSync(join(repo, ".pi", "worktrees", "beta", "dirty.txt"), "x\n");

		const harness = await bootWorktree(repo);
		const result = await harness.run(WORKTREE_TOOLS.list);
		const text = String(result.content[0]?.text ?? "");
		expect(text).toContain("Managed worktrees (3):");

		const rows = text.split("\n").filter((line) => line.includes("worktree-"));
		expect(rows).toHaveLength(3);
		for (const name of names) {
			const row = rows.filter((line) => line.includes(`worktree-${name}`));
			expect(row).toHaveLength(1);
			expect(row[0]).toContain(join(repo, ".pi", "worktrees", name));
		}
		expect(rows.filter((line) => line.includes("worktree-beta"))[0]).toContain("dirty (");
		expect(rows.filter((line) => line.includes("worktree-alpha"))[0]).not.toContain("dirty (");
	});
});
