/**
 * Shared helpers for the worktree test suite.
 *
 * The git primitives (`execP`, `makeRepo`, `makeRepoWithRemote`, `cleanup`)
 * live in `test/helpers/git.ts` and are re-exported here so existing imports
 * keep working.
 */

import { DEFAULT_CONFIG, type WorktreeConfig } from "../../extensions/git/worktree/config.ts";
import { createFakePi, emitFirst } from "../helpers/fakes.ts";
import { execP } from "../helpers/git.ts";

export { cleanup, execP, makeRepo, makeRepoWithRemote, type ExecResult } from "../helpers/git.ts";

type TestConfigOverrides = Partial<Omit<WorktreeConfig, "guard">> & {
	guard?: Partial<WorktreeConfig["guard"]>;
};

/** Build a config from the production defaults, applying test overrides. */
export function testConfig(overrides: TestConfigOverrides = {}): WorktreeConfig {
	const { guard, ...rest } = overrides;
	return {
		...DEFAULT_CONFIG,
		...rest,
		guard: { ...DEFAULT_CONFIG.guard, ...(guard ?? {}) },
	};
}

/** A minimal `pi` API for driving the extension without the Pi runtime. */
export function makeFakePi() {
	const fake = createFakePi({
		exec: (command, args, options) => execP(command, args, options),
	});
	return fake.pi;
}

export interface FakeCtxOptions {
	cwd: string;
	hasUI?: boolean;
	confirm?: boolean;
	select?: string;
}

/** A minimal `ExtensionContext` for tool and event handlers. */
export function makeFakeCtx(pi: any, options: FakeCtxOptions) {
	const statuses = new Map<string, string | undefined>();
	const notices: string[] = [];
	const hasUI = options.hasUI ?? false;
	const ctx: any = {
		cwd: options.cwd,
		hasUI,
		mode: hasUI ? "tui" : "print",
		ui: {
			confirm: async () => options.confirm ?? true,
			select: async () => options.select ?? "Keep it for later",
			input: async () => undefined,
			notify: (message: string) => {
				notices.push(message);
			},
			setStatus: (key: string, value?: string) => {
				if (value === undefined) statuses.delete(key);
				else statuses.set(key, value);
			},
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

/** Invoke every registered handler for an event, returning the first defined result. */
export async function emitEvent(pi: any, event: string, payload: unknown, ctx: any): Promise<any> {
	return emitFirst(pi, event, payload, ctx);
}
