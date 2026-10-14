// Shared real-runtime bootstrap for the package's scripts.
//
// Loads the whole package through the real Pi loader into a headless session
// backed by a scratch git repo and a temp agent dir, so a script can inspect
// and drive the tools, commands, and lifecycle exactly as a real run would.
// Used by `smoke-runtime.ts` and `prompt-budget.ts` so the two cannot drift.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@earendil-works/pi-coding-agent";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { ENV_BRANCH, ENV_MAIN, ENV_ROOT } from "../../extensions/worktree/runtime.ts";

/** Repository root, resolved from this file (`scripts/lib/`). */
export const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/**
 * Extensions the scripts load. `wechat` is included so its `send_wechat` tool is
 * held to the same prompt and annotation checks as the rest; its network work
 * stays lazy until `/wechat start`.
 */
export const EXTENSION_PATHS = [
	"worktree",
	"rewind",
	"ask-user-question",
	"todo",
	"goal",
	"plan",
	"subagent",
	"job",
	"web-access",
	"file-browse",
	"document",
	"file-explorer",
	"memory",
	"wechat",
	"bytefly",
].map((name) => join(repo, "extensions", name, "index.ts"));

/**
 * Load the package into a headless print-mode session.
 *
 * Sets `PI_CODING_AGENT_DIR`, clears any inherited worktree env, and creates a
 * scratch git repo with one commit. Throws when any extension fails to load.
 */
export async function createPackageSession() {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-package-agent-"));
	// Point every extension's config at the temp agent dir. `lib/config.ts` reads
	// `getAgentDir()`, so this redirects the jobs registry too.
	process.env.PI_CODING_AGENT_DIR = agentDir;
	writeFileSync(join(agentDir, "jobs.json"), JSON.stringify({ registryDir: join(agentDir, "jobs") }));

	// The scripts may be launched from inside a worktree, which exports the
	// worktree env to children. Drop it so this in-process session is standalone.
	delete process.env[ENV_ROOT];
	delete process.env[ENV_BRANCH];
	delete process.env[ENV_MAIN];
	delete process.env[ENV_DISABLED_EXTENSIONS];

	const work = mkdtempSync(join(tmpdir(), "pi-package-repo-"));
	const git = (...args: string[]) => execFileSync("git", args, { cwd: work, stdio: "pipe" }).toString();
	git("init", "-q", "-b", "main");
	git("config", "user.email", "t@t");
	git("config", "user.name", "t");
	git("config", "core.autocrlf", "false");
	writeFileSync(join(work, "a.txt"), "hi\n");
	git("add", ".");
	git("commit", "-qm", "init");

	const loader = new DefaultResourceLoader({ cwd: work, agentDir, additionalExtensionPaths: EXTENSION_PATHS });
	await loader.reload();
	const loadErrors = loader.getExtensions().errors;
	if (loadErrors.length > 0) {
		throw new Error(`extension load errors: ${JSON.stringify(loadErrors)}`);
	}

	const sessionManager = SessionManager.inMemory(work);
	const { session } = await createAgentSession({ resourceLoader: loader, sessionManager });
	// `session_start` and the other lifecycle events are emitted by
	// `bindExtensions`, which the real modes call; `createAgentSession` does not.
	await session.bindExtensions({ mode: "print" });

	return {
		session,
		runner: session.extensionRunner,
		sessionManager,
		work,
		agentDir,
		git,
		dispose: () => session.dispose(),
	};
}

export type PackageSession = Awaited<ReturnType<typeof createPackageSession>>;
