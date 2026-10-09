import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { registerRewind } from "../../../extensions/rewind/index.ts";
import type { RunGit } from "../../../extensions/rewind/git.ts";
import type { SnapshotInput } from "../../../extensions/rewind/snapshot.ts";
import { META_MARKER } from "../../../extensions/rewind/store.ts";
import type { Snapshot } from "../../../extensions/rewind/types.ts";
import { useEnv } from "../env.ts";
import { createFakePi, emit, type FakePi } from "../fakes.ts";
import { execP } from "../git.ts";
import { fakeCtx as sharedFakeCtx } from "../context.ts";

export { cleanup, execP, makeRepo } from "../git.ts";

/** Real git behind the rewind `RunGit` interface. */
export const runGit: RunGit = (args, options) =>
	execP("git", args, { cwd: options.cwd, env: options.env, timeout: options.timeoutMs });

/** A unique temporary index path inside a repo's git dir. */
export function indexFileFor(repo: string, label = Math.random().toString(36).slice(2, 7)): string {
	const file = join(repo, ".git", "pi", `rewind-index-${label}`);
	mkdirSync(dirname(file), { recursive: true });
	return file;
}

/** A `SnapshotInput` for tests: `auto`, one session, no conversation anchor. */
export function snapshotInput(root: string, overrides: Partial<SnapshotInput> = {}): SnapshotInput {
	return {
		root,
		indexFile: indexFileFor(root),
		namespace: "refs/pi/rewind",
		reason: "auto",
		includeUntracked: true,
		sessionId: "session-1",
		entryId: null,
		...overrides,
	};
}

/** A stored `Snapshot` fixture for timeline and TUI tests. */
export function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
	return {
		id: "s1",
		ref: "refs/pi/rewind/s1",
		commit: "deadbeef",
		reason: "auto",
		timestamp: 1000,
		root: "/repo",
		head: "deadbeef",
		clean: false,
		includeUntracked: true,
		sessionId: "sess",
		entryId: "e1",
		...overrides,
	};
}

/** A one-entry branch with a single user message. */
export function branchWithUser(id = "e1", text = "do the task") {
	return [
		{
			type: "message",
			id,
			parentId: null,
			timestamp: new Date(1000).toISOString(),
			message: { role: "user", content: text, timestamp: 1000 },
		},
	];
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
	const result = sharedFakeCtx({
		cwd: options.cwd,
		hasUI: options.hasUI ?? false,
		mode: options.mode,
		confirm: options.confirm ?? true,
		select: options.select,
		input: options.input,
		sessionId: options.sessionId ?? "test-session",
		leafId: options.leafId,
		branch: options.branch ?? pi.entries,
	});
	// The current screen factory is invoked immediately, as Pi does.
	result.ctx.ui.custom = async (factory: any) => {
		result.customCalls.push(factory);
		factory({ requestRender: () => {}, terminal: { rows: 40 } }, result.ctx.ui.theme, {}, () => {});
		return undefined;
	};
	return result.ctx;
}

/** Tool annotations for the write that triggers an automatic snapshot. */
export const WRITE_TOOL = { name: "write", annotations: { readOnlyHint: false, destructiveHint: true } };

/** The default tool set: read-only readers, the mutating writers, and bash. */
export const REWIND_TOOLS: any[] = [
	{ name: "read", annotations: { readOnlyHint: true } },
	{ name: "grep", annotations: { readOnlyHint: true } },
	WRITE_TOOL,
	{ name: "edit", annotations: { readOnlyHint: false, destructiveHint: true } },
	{ name: "bash" },
];

/** A registered rewind extension over a fake host with a real git exec. */
export function setupRewind(allTools: any[] = REWIND_TOOLS): FakePi {
	useEnv({ PI_WORKTREE_ROOT: undefined });
	const fake = createFakePi({
		allTools,
		exec: (command, args, options) => execP(command, args, options),
	});
	registerRewind(fake.pi);
	return fake;
}

/** Take one automatic snapshot for the branch's prompt, then dirty the tree. */
export async function primeRewind(fake: FakePi, ctx: any): Promise<void> {
	await emit(fake.pi, "session_start", { reason: "startup" }, ctx);
	await emit(fake.pi, "before_agent_start", { type: "before_agent_start", prompt: "do the task" }, ctx);
	await emit(fake.pi, "tool_call", { toolName: "write", input: {} }, ctx);
	writeFileSync(join(ctx.cwd, "after.txt"), "after\n");
}

/** Answer the point picker with the newest point and the scope picker with `scope`. */
export function answerScope(scope: string): (title: string, labels: string[]) => Promise<string> {
	return async (title, labels) => (title.startsWith("Rewind to which prompt") ? labels[0] : scope);
}

/** Ref names under the rewind namespace. */
export async function rewindRefs(repo: string): Promise<string[]> {
	const out = await execP("git", ["for-each-ref", "--format=%(refname)", "refs/pi/rewind"], { cwd: repo });
	return out.stdout.split("\n").filter(Boolean);
}

/** Parsed metadata for every stored snapshot. */
export async function rewindMetadata(repo: string): Promise<any[]> {
	const out = await execP("git", ["for-each-ref", "--format=%(contents)", "refs/pi/rewind"], { cwd: repo });
	return out.stdout
		.split("\n")
		.filter((line) => line.startsWith(META_MARKER))
		.map((line) => JSON.parse(line.slice(META_MARKER.length)));
}
