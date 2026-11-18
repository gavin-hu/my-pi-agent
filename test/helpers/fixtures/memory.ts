/**
 * Suite harness for the memory extension.
 *
 * Builds a temp repository (with a nested working directory) plus a temp agent
 * directory, points `PI_CODING_AGENT_DIR` at it, and fakes git's `rev-parse` so the
 * project store resolves to the repository root. `worktree: true` models an isolated
 * session instead: the cwd is `<repo>/.pi/worktrees/task` and git answers it as a linked
 * worktree, which is a different tree from the checkout that holds it. Owns teardown, so
 * tests never use `try/finally`. Value-only: all state lives in the returned closure.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import memory from "../../../extensions/memory/index.ts";
import { ENV_ROOT } from "../../../lib/env.ts";
import { fakeCtx } from "../context.ts";
import { useEnv } from "../env.ts";
import { createFakePi, emitCollect } from "../fakes.ts";

type Scope = "project" | "global";

/** How the suite is laid out: a plain checkout, or an isolated session in a worktree. */
export interface MemorySuiteOptions {
	worktree?: boolean;
}

export interface MemorySuite {
	base: string;
	agentDir: string;
	repo: string;
	cwd: string;
	projectPath: string;
	globalPath: string;
	pi: ReturnType<typeof createFakePi>["pi"];
	ctx: any;
	notices: string[];
	setTrusted(value: boolean): void;
	setConfirm(value: boolean): void;
	write(scope: Scope, content: string): void;
	read(scope: Scope): string;
	exists(scope: Scope): boolean;
	/** The registered `/memory` command, for a case that drives a subcommand. */
	command(): any;
	/** Emit `session_start` with the suite's current trust state. */
	start(reason?: string): Promise<void>;
	/** Emit an event, returning every handler result. */
	emit(event: string, payload?: unknown): Promise<any[]>;
	dispose(): void;
}

const GIT_REV_PARSE = "rev-parse";
const SHOW_TOPLEVEL = "--show-toplevel";
const COMMON_DIR = "--git-common-dir";
const WORKTREE_TASK = [".pi", "worktrees", "task"];

/** Build a memory suite rooted in fresh temp directories. */
export function memorySuite(options: MemorySuiteOptions = {}): MemorySuite {
	const worktree = options.worktree === true;
	const base = mkdtempSync(join(tmpdir(), "pi-memory-"));
	const agentDir = join(base, "agent");
	const repo = join(base, "repo");
	const cwd = worktree ? join(repo, ...WORKTREE_TASK) : join(repo, "packages", "app");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	mkdirSync(join(repo, ".pi"), { recursive: true });

	// Windows temp paths can be 8.3 short names; realpath them so the paths the
	// suite asserts equal the ones `getAgentDir()` and `repoRootFor()` produce.
	const realAgentDir = realpathSync.native(agentDir);
	const realRepo = realpathSync.native(repo);
	const realCwd = worktree ? join(realRepo, ...WORKTREE_TASK) : join(realRepo, "packages", "app");

	// `PI_WORKTREE_ROOT` is how an isolated session publishes its root, and the store resolves
	// through it: a suite run inside a worktree would otherwise inherit the developer's own.
	const env = useEnv({
		PI_CODING_AGENT_DIR: realAgentDir,
		[ENV_ROOT]: worktree ? realCwd : undefined,
	});

	const { pi } = createFakePi({
		exec: async (command, args) => {
			if (command === "git" && args[0] === GIT_REV_PARSE) {
				// A linked worktree answers its own root, and the git directory the checkout shares.
				if (args[1] === SHOW_TOPLEVEL) {
					return { stdout: `${worktree ? realCwd : realRepo}\n`, stderr: "", code: 0 };
				}
				if (args.includes(COMMON_DIR)) {
					return { stdout: `${join(realRepo, ".git")}\n`, stderr: "", code: 0 };
				}
			}
			return { stdout: "", stderr: "", code: 0 };
		},
	});

	let trusted = true;
	const context = fakeCtx({ cwd: realCwd, extra: { isProjectTrusted: () => trusted } });

	const projectPath = join(realRepo, ".pi", "memory.md");
	const globalPath = join(realAgentDir, "memory.md");
	const pathFor = (scope: Scope): string => (scope === "global" ? globalPath : projectPath);

	memory(pi);

	return {
		base,
		agentDir,
		repo,
		cwd,
		projectPath,
		globalPath,
		pi,
		ctx: context.ctx,
		notices: context.notifications,
		setTrusted: (value) => {
			trusted = value;
		},
		setConfirm: (value) => {
			context.setConfirm(value);
		},
		write: (scope, content) => {
			mkdirSync(dirname(pathFor(scope)), { recursive: true });
			writeFileSync(pathFor(scope), content, "utf-8");
		},
		command: () => pi.commands.get("memory"),
		read: (scope) => readFileSync(pathFor(scope), "utf-8"),
		exists: (scope) => existsSync(pathFor(scope)),
		start: async (reason = "startup") => {
			await emitCollect(pi, "session_start", { reason }, context.ctx);
			// The store read is started by the handler and awaited by the first turn, so the harness
			// ends a session start the way a turn does: a case that reads the store next sees it.
			await emitCollect(pi, "before_agent_start", {}, context.ctx);
		},
		emit: (event, payload = {}) => emitCollect(pi, event, payload, context.ctx),
		dispose: () => {
			env.restore();
			rmSync(base, { recursive: true, force: true });
		},
	};
}
