import { afterAll, describe, expect, mock, test } from "bun:test";
import { existsSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize } from "../../extensions/worktree/git.ts";
import { loadRegistry, touchRecord } from "../../extensions/worktree/registry.ts";

// --- module mocks (must run before importing the extension) -----------------

mock.module("typebox", () => ({
	Type: {
		String: (options: unknown) => ({ type: "string", ...(options as object) }),
		Number: (options: unknown) => ({ type: "number", ...(options as object) }),
		Boolean: (options: unknown) => ({ type: "boolean", ...(options as object) }),
		Optional: (schema: object) => ({ ...schema, optional: true }),
		Object: (properties: object) => ({ type: "object", properties }),
		Array: (items: object) => ({ type: "array", items }),
	},
}));

mock.module("@earendil-works/pi-coding-agent", () => {
	const def = (name: string) => ({
		name,
		label: name,
		description: `${name} tool`,
		parameters: {},
		promptSnippet: "",
		promptGuidelines: [],
		async execute() {
			return { content: [{ type: "text", text: name }], details: {} };
		},
	});
	return {
		CONFIG_DIR_NAME: ".pi",
		getAgentDir: () => join(tmpdir(), "pi-agent-nonexistent"),
		createReadToolDefinition: () => def("read"),
		createWriteToolDefinition: () => def("write"),
		createEditToolDefinition: () => def("edit"),
		createBashToolDefinition: () => def("bash"),
		createGrepToolDefinition: () => def("grep"),
		createFindToolDefinition: () => def("find"),
		createLsToolDefinition: () => def("ls"),
	};
});

const extension = (await import("../../extensions/worktree/index.ts")).default;
const { cleanup, emitEvent, execP, makeFakeCtx, makeFakePi, makeRepo, makeRepoWithRemote, testConfig } = await import(
	"./helpers.ts"
);

const cleanups: Array<string | undefined> = [];
afterAll(() => {
	mock.restore();
	cleanup(...cleanups);
});

interface BootOptions {
	hasUI?: boolean;
	confirm?: boolean;
	select?: string;
	envRoot?: string;
	envBranch?: string;
	envMain?: string;
	allTools?: any[];
}

async function boot(repo: string, options: BootOptions = {}) {
	if (options.envRoot) process.env.PI_WORKTREE_ROOT = options.envRoot;
	else delete process.env.PI_WORKTREE_ROOT;
	if (options.envBranch) process.env.PI_WORKTREE_BRANCH = options.envBranch;
	else delete process.env.PI_WORKTREE_BRANCH;
	if (options.envMain) process.env.PI_WORKTREE_MAIN = options.envMain;
	else delete process.env.PI_WORKTREE_MAIN;

	const pi = makeFakePi();
	pi.allTools = options.allTools ?? [];
	extension(pi);
	const ctx = makeFakeCtx(pi, {
		cwd: repo,
		hasUI: options.hasUI,
		confirm: options.confirm,
		select: options.select,
	});
	await emitEvent(pi, "session_start", { reason: "startup" }, ctx);
	return { pi, ctx };
}

async function enter(pi: any, ctx: any, params: { name?: string; path?: string }) {
	return pi.tools.get("worktree_enter").execute("enter-1", params, undefined, undefined, ctx);
}

async function exit(pi: any, ctx: any, params: { remove?: boolean; keepBranch?: boolean } = {}) {
	return pi.tools.get("worktree_exit").execute("exit-1", params, undefined, undefined, ctx);
}

async function removeWorktree(repo: string, dir: string, branch: string) {
	await execP("git", ["worktree", "remove", "--force", canonicalize(dir)], { cwd: repo });
	await execP("git", ["branch", "-D", branch], { cwd: repo });
}

function wtPath(repo: string, name: string): string {
	return canonicalize(join(repo, ".pi", "worktrees", name));
}

// ---------------------------------------------------------------------------

describe("extension enter / exit", () => {
	test("enters a worktree, persists state, and removes it on a clean exit", async () => {
		const repo = await makeRepo("pi-wt-ext-");
		cleanups.push(repo);
		const { pi, ctx } = await boot(repo);

		const entered = await enter(pi, ctx, { name: "a" });
		const dir = wtPath(repo, "a");
		expect(entered.content[0].text).toContain("Entered worktree");
		expect(existsSync(dir)).toBe(true);
		expect(ctx.statuses.get("worktree")).toContain("a");
		expect(pi.entries.some((entry: any) => entry.customType === "worktree" && entry.data?.active === true)).toBe(true);
		// Entering records provenance in the registry.
		expect(loadRegistry(repo, testConfig()).worktrees.map((record) => record.path)).toContain(canonicalize(dir));

		const exited = await exit(pi, ctx, { remove: true });
		expect(exited.content[0].text).toContain("Removed worktree");
		expect(existsSync(dir)).toBe(false);
		// A removed worktree is dropped from the registry.
		expect(loadRegistry(repo, testConfig()).worktrees.map((record) => record.path)).not.toContain(canonicalize(dir));
		const branches = await execP("git", ["branch"], { cwd: repo });
		expect(branches.stdout).not.toContain("worktree-a");
	});

	test("keeps a dirty worktree when exiting without UI", async () => {
		const repo = await makeRepo("pi-wt-ext-");
		cleanups.push(repo);
		const { pi, ctx } = await boot(repo);
		await enter(pi, ctx, { name: "dirty" });
		const dir = wtPath(repo, "dirty");
		writeFileSync(join(dir, "work.txt"), "x");

		const exited = await exit(pi, ctx, {});
		expect(exited.content[0].text).toContain("Kept worktree");
		expect(existsSync(dir)).toBe(true);
		await removeWorktree(repo, dir, "worktree-dirty");
	});

	test("enforces isolation from the tool_call handler", async () => {
		const repo = await makeRepo("pi-wt-ext-");
		cleanups.push(repo);
		const { pi, ctx } = await boot(repo);
		await enter(pi, ctx, { name: "guard" });

		const handler = pi.handlers.get("tool_call")[0];
		expect(handler({ toolName: "write", input: { path: join(repo, "outside.txt") } })).toMatchObject({ block: true });
		expect(handler({ toolName: "write", input: { path: "inside.txt" } })).toBeUndefined();
		expect(handler({ toolName: "bash", input: { command: `git -C ${repo} status` } })).toMatchObject({ block: true });
		expect(handler({ toolName: "bash", input: { command: "git status" } })).toBeUndefined();

		await exit(pi, ctx, { remove: true });
	});

	test("refuses a worktree name that escapes the managed directory", async () => {
		const repo = await makeRepo("pi-wt-ext-");
		cleanups.push(repo);
		const { pi, ctx } = await boot(repo);
		const escaped = join(tmpdir(), `pi-wt-escape-${Date.now()}`);
		try {
			await enter(pi, ctx, { name: escaped });
			expect.unreachable();
		} catch (error) {
			expect((error as Error).message).toMatch(/outside/);
		}
		expect(existsSync(escaped)).toBe(false);
	});

	test("registers a single worktree command and its tools", async () => {
		const repo = await makeRepo("pi-wt-ext-");
		cleanups.push(repo);
		const { pi } = await boot(repo);
		expect([...pi.commands.keys()]).toEqual(["worktree"]);
		for (const name of ["worktree_enter", "worktree_exit", "worktree_prune", "worktree_status"]) {
			expect(pi.tools.has(name)).toBe(true);
		}
	});

	test("dispatches worktree subcommands", async () => {
		const repo = await makeRepo("pi-wt-ext-");
		cleanups.push(repo);
		const { pi, ctx } = await boot(repo);
		const command = pi.commands.get("worktree");
		const run = (args: string) => command.handler(args, ctx);

		// Bare invocation and `status` both report the current state.
		await run("");
		expect(ctx.notices.at(-1)).toContain("Not in a worktree.");
		await run("status");
		expect(ctx.notices.at(-1)).toContain("Not in a worktree.");

		// `enter <name>` creates the worktree and rebinds the root.
		await run("enter cmd");
		const dir = wtPath(repo, "cmd");
		expect(ctx.notices.at(-1)).toContain("Entered worktree");
		expect(existsSync(dir)).toBe(true);

		// `prune` keeps the current worktree and reports it.
		await run("prune");
		expect(ctx.notices.at(-1)).toContain("Kept");
		expect(ctx.notices.at(-1)).toContain("current");

		// `exit --remove` returns to the main checkout and cleans up.
		await run("exit --remove");
		expect(ctx.notices.at(-1)).toContain("Removed worktree");
		expect(existsSync(dir)).toBe(false);

		// Unknown subcommands produce usage instead of running anything.
		await run("bogus");
		expect(ctx.notices.at(-1)).toContain('Unknown worktree subcommand "bogus"');
		expect(ctx.notices.at(-1)).toContain("Usage: /worktree");
	});

	test("completes worktree subcommands and exit flags", async () => {
		const repo = await makeRepo("pi-wt-ext-");
		cleanups.push(repo);
		const { pi } = await boot(repo);
		const completions = pi.commands.get("worktree").getArgumentCompletions as (prefix: string) => any;

		const all = completions("");
		expect(all.map((item: any) => item.value)).toEqual(["status ", "enter ", "exit ", "prune "]);

		expect(completions("e").map((item: any) => item.label)).toEqual(["enter", "exit"]);
		expect(completions("exit ").map((item: any) => item.label)).toEqual(["--keep", "--remove"]);
		expect(completions("exit --k").map((item: any) => item.label)).toEqual(["--keep"]);
		expect(completions("enter ")).toBeNull();
	});

	test("reports inactive overrides through worktree_status", async () => {
		const repo = await makeRepo("pi-wt-ext-");
		cleanups.push(repo);
		const builtinBash = {
			name: "bash",
			description: "",
			parameters: {},
			promptGuidelines: [],
			exposure: "direct",
			sourceInfo: { path: "builtin:bash", source: "builtin", scope: "global", origin: "top-level" },
		};
		const { pi, ctx } = await boot(repo, { allTools: [builtinBash] });
		const result = await pi.tools.get("worktree_status").execute("s1", {}, undefined, undefined, ctx);
		expect(result.content[0].text).toMatch(/not active for: bash/);
	});

	test("reports no inactive overrides when ours are effective", async () => {
		const repo = await makeRepo("pi-wt-ext-");
		cleanups.push(repo);
		const self = fileURLToPath(new URL("../../extensions/worktree/index.ts", import.meta.url));
		const tools = ["read", "write", "edit", "bash", "grep", "find", "ls"].map((name) => ({
			name,
			description: "",
			parameters: {},
			promptGuidelines: [],
			exposure: "direct",
			sourceInfo: { path: self, source: "extension", scope: "temporary", origin: "top-level" },
		}));
		const { pi, ctx } = await boot(repo, { allTools: tools });
		const result = await pi.tools.get("worktree_status").execute("s1", {}, undefined, undefined, ctx);
		expect(result.content[0].text).not.toContain("not active for");
	});

	test("refuses to enter the main checkout as a worktree", async () => {
		const repo = await makeRepo("pi-wt-ext-");
		cleanups.push(repo);
		const { pi, ctx } = await boot(repo);
		await expect(enter(pi, ctx, { path: repo })).rejects.toThrow(/main checkout/i);
	});

	test("keeps a branch with unmerged commits even on a forced removal", async () => {
		const repo = await makeRepo("pi-wt-ext-");
		cleanups.push(repo);
		const { pi, ctx } = await boot(repo);
		await enter(pi, ctx, { name: "commits" });
		const dir = wtPath(repo, "commits");
		writeFileSync(join(dir, "new.txt"), "x");
		await execP("git", ["add", "."], { cwd: dir });
		await execP("git", ["commit", "-qm", "work"], { cwd: dir });

		const exited = await exit(pi, ctx, { remove: true });
		expect(exited.content[0].text).toContain("Removed worktree");
		expect(exited.content[0].text).toMatch(/Kept branch worktree-commits/);
		expect(existsSync(dir)).toBe(false);
		const branches = await execP("git", ["branch"], { cwd: repo });
		expect(branches.stdout).toContain("worktree-commits");
		await execP("git", ["branch", "-D", "worktree-commits"], { cwd: repo });
	});

	test("keeps commits made in a worktree entered by path", async () => {
		const repo = await makeRepo("pi-wt-ext-");
		cleanups.push(repo);
		const { pi, ctx } = await boot(repo);

		// Create a managed worktree, keep it, then re-enter it by path.
		await enter(pi, ctx, { name: "bypath" });
		const dir = wtPath(repo, "bypath");
		await exit(pi, ctx, { remove: false });

		// A commit inside the pre-existing worktree must be seen as work.
		writeFileSync(join(dir, "new.txt"), "x");
		await execP("git", ["add", "."], { cwd: dir });
		await execP("git", ["commit", "-qm", "work"], { cwd: dir });

		await enter(pi, ctx, { path: dir });
		const exited = await exit(pi, ctx, { remove: true });
		expect(exited.content[0].text).toContain("Removed worktree");
		expect(exited.content[0].text).toMatch(/Kept branch worktree-bypath/);
		const branches = await execP("git", ["branch"], { cwd: repo });
		expect(branches.stdout).toContain("worktree-bypath");
		await execP("git", ["branch", "-D", "worktree-bypath"], { cwd: repo });
	});

	test("keeps a dirty worktree's branch when the user chooses remove", async () => {
		const repo = await makeRepo("pi-wt-ext-");
		cleanups.push(repo);
		const { pi, ctx } = await boot(repo, { hasUI: true, select: "Remove it and its branch" });
		await enter(pi, ctx, { name: "dirty2" });
		const dir = wtPath(repo, "dirty2");
		writeFileSync(join(dir, "work.txt"), "x");

		const exited = await exit(pi, ctx, {});
		expect(exited.content[0].text).toContain("Removed worktree");
		expect(exited.content[0].text).toContain("Kept branch worktree-dirty2");
		expect(existsSync(dir)).toBe(false);
		await execP("git", ["branch", "-D", "worktree-dirty2"], { cwd: repo });
	});

	test("re-enters a worktree whose branch was kept on exit", async () => {
		const repo = await makeRepo("pi-wt-ext-");
		cleanups.push(repo);
		const { pi, ctx } = await boot(repo);

		await enter(pi, ctx, { name: "reuse" });
		const dir = wtPath(repo, "reuse");
		writeFileSync(join(dir, "work.txt"), "x");
		const exited = await exit(pi, ctx, { remove: true, keepBranch: true });
		expect(exited.content[0].text).toContain("Kept branch worktree-reuse");
		expect(existsSync(dir)).toBe(false);

		// The branch survives, so the same name must attach it instead of failing.
		const reentered = await enter(pi, ctx, { name: "reuse" });
		expect(reentered.content[0].text).toContain("Entered worktree");
		expect(existsSync(dir)).toBe(true);
		const final = await exit(pi, ctx, { remove: true, keepBranch: true });
		expect(final.content[0].text).toContain("Removed worktree");
		await execP("git", ["branch", "-D", "worktree-reuse"], { cwd: repo });
	});
});

describe("borrowed worktree (subagent)", () => {
	test("binds to the inherited root and refuses to change it", async () => {
		const repo = await makeRepo("pi-wt-borrow-");
		cleanups.push(repo);

		// Prepare a kept worktree as the parent would leave it.
		const parent = await boot(repo);
		await enter(parent.pi, parent.ctx, { name: "borrow" });
		await exit(parent.pi, parent.ctx, { remove: false });
		const dir = wtPath(repo, "borrow");
		expect(existsSync(dir)).toBe(true);

		const { pi, ctx } = await boot(repo, { envRoot: dir, envBranch: "worktree-borrow", envMain: repo });
		expect(ctx.statuses.get("worktree")).toContain("borrow");

		// The child records the main checkout as repoRoot, not the worktree.
		const status = await pi.tools.get("worktree_status").execute("s", {}, undefined, undefined, ctx);
		expect(status.content[0].text).toContain(`main:   ${canonicalize(repo)}`);

		await expect(enter(pi, ctx, { name: "x" })).rejects.toThrow(/inherited/i);
		await expect(exit(pi, ctx, {})).rejects.toThrow(/inherited|parent/i);

		const handler = pi.handlers.get("tool_call")[0];
		expect(handler({ toolName: "write", input: { path: join(repo, "outside.txt") } })).toMatchObject({ block: true });
		expect(handler({ toolName: "write", input: { path: "inside.txt" } })).toBeUndefined();

		delete process.env.PI_WORKTREE_ROOT;
		delete process.env.PI_WORKTREE_BRANCH;
		await removeWorktree(repo, dir, "worktree-borrow");
	});
});

describe("prune", () => {
	test("removes an aged, clean worktree and keeps a recent one", async () => {
		const { repo, remote } = await makeRepoWithRemote("pi-wt-prune-");
		cleanups.push(repo, remote);

		const first = await boot(repo);
		await enter(first.pi, first.ctx, { name: "old" });
		await exit(first.pi, first.ctx, { remove: false });
		await enter(first.pi, first.ctx, { name: "new" });
		await exit(first.pi, first.ctx, { remove: false });

		const oldDir = wtPath(repo, "old");
		const newDir = wtPath(repo, "new");
		const past = new Date(Date.now() - 30 * 86_400_000);
		utimesSync(oldDir, past, past);
		touchRecord(repo, testConfig(), oldDir, past.getTime());

		// Fresh boot so no worktree is current.
		const { pi, ctx } = await boot(repo);
		const result = await pi.tools.get("worktree_prune").execute("p1", {}, undefined, undefined, ctx);
		const text = result.content[0].text;

		expect(text).toContain(`Removed ${oldDir}`);
		expect(existsSync(oldDir)).toBe(false);
		expect(existsSync(newDir)).toBe(true);
		expect(text).toContain(newDir);

		await removeWorktree(repo, newDir, "worktree-new");
	});
});

describe("prune edge cases", () => {
	function age(repo: string, dir: string, days = 30): void {
		const past = new Date(Date.now() - days * 86_400_000);
		utimesSync(dir, past, past);
		touchRecord(repo, testConfig(), dir, past.getTime());
	}

	async function prune(pi: any, ctx: any): Promise<string> {
		const result = await pi.tools.get("worktree_prune").execute("p", {}, undefined, undefined, ctx);
		return result.content[0].text;
	}

	test("keeps the current worktree", async () => {
		const { repo, remote } = await makeRepoWithRemote("pi-wt-prune-cur-");
		cleanups.push(repo, remote);
		const { pi, ctx } = await boot(repo);
		await enter(pi, ctx, { name: "cur" });
		const dir = wtPath(repo, "cur");

		expect(await prune(pi, ctx)).toContain(`${dir} (current)`);
		expect(existsSync(dir)).toBe(true);
	});

	test("keeps a worktree locked by a live process", async () => {
		const { repo, remote } = await makeRepoWithRemote("pi-wt-prune-live-");
		cleanups.push(repo, remote);
		const first = await boot(repo);
		await enter(first.pi, first.ctx, { name: "live" });
		await exit(first.pi, first.ctx, { remove: false });
		const dir = wtPath(repo, "live");
		await execP("git", ["worktree", "lock", "--reason", `pi:${process.pid}:sess`, dir], { cwd: repo });
		age(repo, dir);

		const { pi, ctx } = await boot(repo);
		expect(await prune(pi, ctx)).toContain(`${dir} (locked)`);
		expect(existsSync(dir)).toBe(true);
	});

	test("unlocks and prunes a worktree locked by a dead process", async () => {
		const { repo, remote } = await makeRepoWithRemote("pi-wt-prune-dead-");
		cleanups.push(repo, remote);
		const first = await boot(repo);
		await enter(first.pi, first.ctx, { name: "dead" });
		await exit(first.pi, first.ctx, { remove: false });
		const dir = wtPath(repo, "dead");
		await execP("git", ["worktree", "lock", "--reason", "pi:999999:sess", dir], { cwd: repo });
		age(repo, dir);

		const { pi, ctx } = await boot(repo);
		expect(await prune(pi, ctx)).toContain(`Removed ${dir}`);
		expect(existsSync(dir)).toBe(false);
	});

	test("keeps a worktree that contains work", async () => {
		const { repo, remote } = await makeRepoWithRemote("pi-wt-prune-work-");
		cleanups.push(repo, remote);
		const first = await boot(repo);
		await enter(first.pi, first.ctx, { name: "work" });
		await exit(first.pi, first.ctx, { remove: false });
		const dir = wtPath(repo, "work");
		writeFileSync(join(dir, "dirty.txt"), "x");
		age(repo, dir);

		const { pi, ctx } = await boot(repo);
		expect(await prune(pi, ctx)).toContain(`${dir} (has work)`);
		expect(existsSync(dir)).toBe(true);
	});

	test("keeps a worktree when the default branch is unknown", async () => {
		const repo = await makeRepo("pi-wt-prune-nodef-");
		cleanups.push(repo);
		const first = await boot(repo);
		await enter(first.pi, first.ctx, { name: "nodef" });
		await exit(first.pi, first.ctx, { remove: false });
		const dir = wtPath(repo, "nodef");
		age(repo, dir);

		const { pi, ctx } = await boot(repo);
		expect(await prune(pi, ctx)).toContain(`${dir} (no default branch)`);
		expect(existsSync(dir)).toBe(true);
	});
});
