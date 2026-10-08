/**
 * Shared helpers for the rewind test suite.
 *
 * `runGit` drives the real git binary through the shared `execP` wrapper; the
 * fake `pi` and `ctx` are the minimal host surface the extension uses.
 */

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RunGit } from "../../extensions/git/rewind/git.ts";
import { createFakePi, type FakePi } from "../helpers/fakes.ts";
import { execP } from "../helpers/git.ts";

export { cleanup, execP, makeRepo, makeRepoWithRemote } from "../helpers/git.ts";

/** Real git behind the rewind `RunGit` interface. */
export const runGit: RunGit = (args, options) =>
	execP("git", args, { cwd: options.cwd, env: options.env, timeout: options.timeoutMs });

/** A unique temporary index path inside a repo's git dir. */
export function indexFileFor(repo: string, label = Math.random().toString(36).slice(2, 7)): string {
	const file = join(repo, ".git", "pi", `rewind-index-${label}`);
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
	mode?: string;
	confirm?: boolean;
	select?: string;
	input?: string;
	/** Session id reported by the fake session manager. */
	sessionId?: string;
	/** Branch entries returned by `getBranch`; defaults to the fake's appended entries. */
	branch?: unknown[];
	/** Leaf id reported by the fake session manager. */
	leafId?: string;
}

/** A minimal `ExtensionContext` for command and event handlers. */
export function makeCtx(pi: FakePi, options: FakeCtxOptions) {
	const statuses = new Map<string, string | undefined>();
	const notices: Array<{ message: string; kind?: string }> = [];
	const selects: string[][] = [];
	const navigations: string[] = [];
	const editorSets: string[] = [];
	const customCalls: any[] = [];
	const hasUI = options.hasUI ?? false;
	const theme = { fg: (_c: string, t: string) => t, bold: (t: string) => t };
	const ctx: any = {
		cwd: options.cwd,
		hasUI,
		mode: options.mode ?? (hasUI ? "tui" : "print"),
		isIdle: () => true,
		waitForIdle: async () => {},
		navigateTree: async (targetId: string) => {
			navigations.push(targetId);
			return { cancelled: false };
		},
		ui: {
			confirm: async () => options.confirm ?? true,
			select: async (_title: string, labels: string[]) => {
				selects.push(labels);
				return options.select ?? undefined;
			},
			input: async () => options.input ?? undefined,
			getEditorText: () => "",
			setEditorText: (text: string) => {
				editorSets.push(text);
			},
			custom: async (factory: any) => {
				customCalls.push(factory);
				factory({ requestRender: () => {}, terminal: { rows: 40 } }, theme, {}, () => {});
				return undefined;
			},
			notify: (message: string, kind?: string) => {
				notices.push({ message, kind });
			},
			setStatus: (key: string, value?: string) => {
				if (value === undefined) statuses.delete(key);
				else statuses.set(key, value);
			},
			theme,
		},
		sessionManager: {
			getSessionId: () => options.sessionId ?? "test-session",
			getLeafId: () => options.leafId ?? undefined,
			getBranch: () => options.branch ?? pi.entries,
		},
		notices,
		statuses,
		selects,
		navigations,
		editorSets,
		customCalls,
	};
	return ctx;
}
