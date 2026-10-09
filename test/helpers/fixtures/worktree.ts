import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, type WorktreeConfig } from "../../../extensions/worktree/config.ts";
import { canonicalize } from "../../../extensions/worktree/git.ts";
import { ENV_BRANCH, ENV_MAIN, ENV_ROOT } from "../../../extensions/worktree/runtime.ts";
import {
	ROOT_TOOL_NAMES,
	type BuiltinFactory,
	type FactoryOptions,
	type RootToolName,
} from "../../../extensions/worktree/root-tools.ts";
import { registerWorktree } from "../../../extensions/worktree/index.ts";
import { createFakePi, emitFirst } from "../fakes.ts";
import { execP } from "../git.ts";
import { fakeCtx as sharedFakeCtx } from "../context.ts";
import { useAgentDir } from "../env.ts";

export {
	cleanup,
	execP,
	makeRepo,
	makeRepoWithRemote,
	makeTempTracker,
	type ExecResult,
	type TempTracker,
} from "../git.ts";

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

/** The file Pi records as the extension entry, for inactive-override checks. */
export const WORKTREE_ENTRY = canonicalize(
	fileURLToPath(new URL("../../../extensions/worktree/index.ts", import.meta.url)),
);

/** Test `createBuiltin` seam: a minimal host built-in definition. */
export function makeBuiltinStub(): {
	createBuiltin: BuiltinFactory;
	calls: Array<{ name: RootToolName; cwd: string; options: FactoryOptions }>;
} {
	const calls: Array<{ name: RootToolName; cwd: string; options: FactoryOptions }> = [];
	const createBuiltin: BuiltinFactory = (name, cwd, options: FactoryOptions) => {
		calls.push({ name, cwd, options });
		return {
			name,
			label: name,
			description: `${name} tool`,
			parameters: {},
			promptSnippet: "",
			promptGuidelines: [],
			defaultActive: false,
			async execute() {
				return { content: [{ type: "text", text: `${name}:${cwd}` }], details: {} };
			},
		};
	};
	return { createBuiltin, calls };
}

// Set or clear the worktree env vars the extension reads on startup.
export function setWorktreeEnv(env: { root?: string; branch?: string; main?: string } = {}): void {
	if (env.root) process.env[ENV_ROOT] = env.root;
	else delete process.env[ENV_ROOT];
	if (env.branch) process.env[ENV_BRANCH] = env.branch;
	else delete process.env[ENV_BRANCH];
	if (env.main) process.env[ENV_MAIN] = env.main;
	else delete process.env[ENV_MAIN];
}

/**
 * Point `PI_CODING_AGENT_DIR` at a fresh temp dir so `loadConfig` never reads
 * the developer's `~/.pi/agent/worktree.json` (the reason the old suite used
 * `mock.module`). The preload restores the variable after every test.
 */
function isolateAgentDir(): void {
	// The preload restores the variable after every test, so the restore handle
	// is intentionally dropped here.
	useAgentDir("pi-wt-agent-");
}

/** A minimal `pi` API for driving the extension without the Pi runtime. */
export function makeFakePi() {
	isolateAgentDir();
	const fake = createFakePi({
		exec: (command, args, options) => execP(command, args, options),
	});
	return fake.pi;
}

export interface WorktreePiOptions {
	/** Tools reported by `getAllTools`, for inactive-override checks. */
	allTools?: any[];
	/** Override the recorded entry path. */
	entryPath?: string;
	/** Defaults returned by `getFlag` for flags registered without one. */
	flagDefaults?: Record<string, unknown>;
	/** Settings returned by `getSettings`, for root-tool option forwarding. */
	settings?: unknown;
}

/** Built-in entries that a healthy session reports as our own overrides. */
function selfToolEntries(entryPath: string) {
	return ROOT_TOOL_NAMES.map((name) => ({
		name,
		description: "",
		parameters: {},
		promptGuidelines: [],
		exposure: "direct",
		sourceInfo: { path: entryPath, source: "extension", scope: "temporary", origin: "top-level" },
	}));
}

/** Build a `pi` with the worktree extension registered and a stubbed host. */
export function makeWorktreePi(options: WorktreePiOptions = {}) {
	isolateAgentDir();
	const fake = createFakePi({
		exec: (command, args, options) => execP(command, args, options),
		flagDefaults: options.flagDefaults,
		settings: options.settings,
	});
	const pi = fake.pi;
	pi.allTools = options.allTools ?? selfToolEntries(options.entryPath ?? WORKTREE_ENTRY);
	const builtins = makeBuiltinStub();
	registerWorktree(pi, { entryPath: options.entryPath ?? WORKTREE_ENTRY, createBuiltin: builtins.createBuiltin });
	return { pi, builtins };
}

export interface FakeCtxOptions {
	cwd: string;
	hasUI?: boolean;
	confirm?: boolean;
	select?: string;
}

/** A minimal `ExtensionContext` for tool and event handlers. */
export function makeFakeCtx(pi: any, options: FakeCtxOptions) {
	const hasUI = options.hasUI ?? false;
	const result = sharedFakeCtx({
		cwd: options.cwd,
		hasUI,
		mode: hasUI ? "tui" : "print",
		confirm: options.confirm ?? true,
		select: options.select ?? "Keep it for later",
		branch: pi.entries,
		sessionId: "test-session",
	});
	// The worktree suite reads notification messages as plain strings.
	result.ctx.notices = result.notifications;
	// Kinded notices (message + level) for tests that assert `info` vs `error`.
	result.ctx.noticeEntries = result.notices;
	return result.ctx;
}

/** Invoke every registered handler for an event, returning the first defined result. */
export async function emitEvent(pi: any, event: string, payload: unknown, ctx: any): Promise<any> {
	return emitFirst(pi, event, payload, ctx);
}

export interface WorktreeBootOptions extends WorktreePiOptions {
	hasUI?: boolean;
	confirm?: boolean;
	select?: string;
	env?: { root?: string; branch?: string; main?: string };
}

export interface WorktreeHarness {
	pi: any;
	ctx: any;
	builtins: ReturnType<typeof makeBuiltinStub>;
	/** Run a registered worktree tool by name. */
	run(name: string, params?: unknown): Promise<any>;
	/** Run the `/worktree` command with a raw argument string. */
	command(args: string): Promise<unknown>;
}

/**
 * Register the extension, build a context, and start the session. The caller
 * owns the repo and its teardown via `makeTempTracker`.
 */
export async function bootWorktree(repo: string, options: WorktreeBootOptions = {}): Promise<WorktreeHarness> {
	setWorktreeEnv(options.env);
	const { pi, builtins } = makeWorktreePi(options);
	const ctx = makeFakeCtx(pi, {
		cwd: repo,
		hasUI: options.hasUI,
		confirm: options.confirm,
		select: options.select,
	});
	await emitEvent(pi, "session_start", { reason: "startup" }, ctx);
	return {
		pi,
		ctx,
		builtins,
		run: (name, params = {}) => pi.tools.get(name).execute("call-1", params, undefined, undefined, ctx),
		command: (args) => pi.commands.get("worktree").handler(args, ctx),
	};
}
