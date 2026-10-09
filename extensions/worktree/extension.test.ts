import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT_TOOL_NAMES } from "./root-tools.ts";
import { WORKTREE_TOOLS } from "./tools.ts";
import { makeRepo, makeTempTracker } from "../../test/helpers/git.ts";
import { bootWorktree, emitEvent, makeWorktreePi, WORKTREE_ENTRY } from "../../test/helpers/fixtures/worktree.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { withEnv } from "../../test/helpers/env.ts";
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

describe("worktree registration", () => {
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

describe("worktree session lifecycle", () => {
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
