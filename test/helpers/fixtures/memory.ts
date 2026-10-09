/**
 * Suite harness for the memory extension.
 *
 * Builds a temp repository (with a nested working directory) plus a temp agent
 * directory, points `PI_CODING_AGENT_DIR` at it, and fakes `git rev-parse
 * --show-toplevel` so the project store resolves to the repository root. Owns
 * teardown, so tests never use `try/finally`. Value-only: all state lives in the
 * returned closure.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import memory from "../../../extensions/memory/index.ts";
import { fakeCtx } from "../context.ts";
import { useEnv } from "../env.ts";
import { createFakePi, emitCollect } from "../fakes.ts";

type Scope = "project" | "global";

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
	/** Emit `session_start` with the suite's current trust state. */
	start(reason?: string): Promise<void>;
	/** Emit an event, returning every handler result. */
	emit(event: string, payload?: unknown): Promise<any[]>;
	dispose(): void;
}

const GIT_REV_PARSE = ["rev-parse", "--show-toplevel"];

/** Build a memory suite rooted in fresh temp directories. */
export function memorySuite(): MemorySuite {
	const base = mkdtempSync(join(tmpdir(), "pi-memory-"));
	const agentDir = join(base, "agent");
	const repo = join(base, "repo");
	const cwd = join(repo, "packages", "app");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	mkdirSync(join(repo, ".pi"), { recursive: true });

	// Windows temp paths can be 8.3 short names; realpath them so the paths the
	// suite asserts equal the ones `getAgentDir()` and `repoRootFor()` produce.
	const realAgentDir = realpathSync.native(agentDir);
	const realRepo = realpathSync.native(repo);
	const realCwd = join(realRepo, "packages", "app");

	const env = useEnv({ PI_CODING_AGENT_DIR: realAgentDir });

	const { pi } = createFakePi({
		exec: async (command, args) => {
			if (command === "git" && args[0] === GIT_REV_PARSE[0] && args[1] === GIT_REV_PARSE[1]) {
				return { stdout: `${realRepo}\n`, stderr: "", code: 0 };
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
		read: (scope) => readFileSync(pathFor(scope), "utf-8"),
		exists: (scope) => existsSync(pathFor(scope)),
		start: async (reason = "startup") => {
			await emitCollect(pi, "session_start", { reason }, context.ctx);
		},
		emit: (event, payload = {}) => emitCollect(pi, event, payload, context.ctx),
		dispose: () => {
			env.restore();
			rmSync(base, { recursive: true, force: true });
		},
	};
}
