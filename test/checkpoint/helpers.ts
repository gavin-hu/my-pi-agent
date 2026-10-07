/**
 * Shared helpers for the checkpoint test suite.
 *
 * `runGit` drives the real git binary through the shared `execP` wrapper; the
 * fake `pi` and `ctx` are the minimal host surface the extension uses.
 */

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RunGit } from "../../extensions/checkpoint/git.ts";
import { createFakePi, type FakePi } from "../helpers/fakes.ts";
import { execP } from "../helpers/git.ts";

export { cleanup, execP, makeRepo, makeRepoWithRemote } from "../helpers/git.ts";

/** Real git behind the checkpoint `RunGit` interface. */
export const runGit: RunGit = (args, options) =>
	execP("git", args, { cwd: options.cwd, env: options.env, timeout: options.timeoutMs });

/** A unique temporary index path inside a repo's git dir. */
export function indexFileFor(repo: string, label = Math.random().toString(36).slice(2, 7)): string {
	const file = join(repo, ".git", "pi", `checkpoint-index-${label}`);
	mkdirSync(dirname(file), { recursive: true });
	return file;
}

/** A fake `pi` whose `exec` runs real git. */
export function makeFakePi(): FakePi {
	delete process.env.PI_WORKTREE_ROOT;
	return createFakePi({ exec: (command, args, options) => execP(command, args, options) });
}

export interface FakeCtxOptions {
	cwd: string;
	hasUI?: boolean;
	confirm?: boolean;
	select?: string;
}

/** A minimal `ExtensionContext` for tool and event handlers. */
export function makeCtx(pi: FakePi, options: FakeCtxOptions) {
	const statuses = new Map<string, string | undefined>();
	const notices: Array<{ message: string; kind?: string }> = [];
	const hasUI = options.hasUI ?? false;
	const ctx: any = {
		cwd: options.cwd,
		hasUI,
		mode: hasUI ? "tui" : "print",
		ui: {
			confirm: async () => options.confirm ?? true,
			select: async () => options.select ?? undefined,
			notify: (message: string, kind?: string) => {
				notices.push({ message, kind });
			},
			setStatus: (key: string, value?: string) => {
				if (value === undefined) statuses.delete(key);
				else statuses.set(key, value);
			},
			theme: { fg: (_c: string, t: string) => t, bold: (t: string) => t },
		},
		sessionManager: {
			getSessionId: () => "test-session",
			getBranch: () => pi.entries,
		},
		notices,
		statuses,
	};
	return ctx;
}
