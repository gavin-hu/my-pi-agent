import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_CONFIG, loadConfig, normalizeConfig, type RewindConfig } from "../config/config.ts";
import { commitTree, revParse, updateRef } from "./git.ts";
import { createSnapshotPolicy } from "../state/policy.ts";
import { createOperationQueue } from "./queue.ts";
import type { RewindRuntime, SnapshotOptions } from "../state/runtime.ts";
import { createSnapshotRun } from "../state/snapshot-run.ts";
import { createSnapshot } from "./snapshot.ts";
import {
	belongsToRoot,
	deleteSnapshots,
	encodeMessage,
	idFromRef,
	listSnapshots,
	META_VERSION,
	parseMessage,
	pruneSnapshots,
	refFor,
	type SnapshotMeta,
} from "./store.ts";
import { createTempIndexStore } from "./temp-index.ts";
import type { Snapshot } from "../types.ts";
import { tempDir, withAgentDir } from "../../../test/helpers/env.ts";
import { createFakePi } from "../../../test/helpers/fakes.ts";
import { cleanup, makeRepo } from "../../../test/helpers/git.ts";
import { runSlowSuites } from "../../../test/helpers/slow-suite.ts";
import { branchWithUser, makeCtx, makeSnapshot, runGit, snapshotInput } from "../../../test/helpers/fixtures/rewind.ts";

const cleanups: string[] = [];
afterAll(() => cleanup(...cleanups));

const NS = "refs/pi/rewind";

function meta(overrides: Partial<SnapshotMeta> = {}): SnapshotMeta {
	return {
		v: META_VERSION,
		id: "x",
		reason: "auto",
		timestamp: 1000,
		root: "/repo",
		head: "h",
		clean: true,
		includeUntracked: true,
		sessionId: "session-1",
		entryId: null,
		...overrides,
	};
}

describe("rewind config", () => {
	test("falls back for a wrong-typed flag and clamps max to its range", () => {
		const kept = normalizeConfig({ autoSnapshots: "sometimes", max: 99999 }, DEFAULT_CONFIG);

		expect(kept.autoSnapshots).toBe(true);
		expect(kept.max).toBe(1000);
		expect(normalizeConfig({ max: -5 }, DEFAULT_CONFIG).max).toBe(0);
	});

	test("accepts a boolean flag", () => {
		expect(normalizeConfig({ autoSnapshots: false }, DEFAULT_CONFIG).autoSnapshots).toBe(false);
		expect(normalizeConfig({ autoSnapshots: true }, DEFAULT_CONFIG).autoSnapshots).toBe(true);
	});

	test("keeps string list entries only and trims the namespace", () => {
		const config = normalizeConfig({ watch: ["bash", 3, "  "], refNamespace: "refs/x//" }, DEFAULT_CONFIG);

		expect(config.watch).toEqual(["bash"]);
		expect(config.refNamespace).toBe("refs/x");
	});

	test("returns the defaults when no config file exists", async () => {
		await withAgentDir(() => {
			expect(loadConfig(tempDir("rewind-repo-"))).toEqual(DEFAULT_CONFIG);
		}, "rewind-global-");
	});

	test("merges the global then the project document, project winning", async () => {
		const repo = tempDir("rewind-repo-");
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(repo, ".pi", "bytefly.json"), JSON.stringify({ rewind: { max: 9 } }));

		await withAgentDir((globalDir) => {
			writeFileSync(join(globalDir, "bytefly.json"), JSON.stringify({ rewind: { autoSnapshots: false, max: 5 } }));
			const config = loadConfig(repo);
			expect(config.autoSnapshots).toBe(false);
			expect(config.max).toBe(9);
		}, "rewind-global-");
	});

	test("ignores a malformed document", async () => {
		await withAgentDir((globalDir) => {
			writeFileSync(join(globalDir, "bytefly.json"), "{ not json");
			expect(loadConfig(tempDir("rewind-repo-"))).toEqual(DEFAULT_CONFIG);
		}, "rewind-global-");
	});
});

const POLICY_TOOLS = [
	{ name: "read", annotations: { readOnlyHint: true } },
	{ name: "grep", annotations: { readOnlyHint: true } },
	{ name: "find", annotations: { readOnlyHint: true } },
	{ name: "ls", annotations: { readOnlyHint: true } },
	{ name: "todo" },
	{ name: "goal" },
	{ name: "write", annotations: { readOnlyHint: false, destructiveHint: true } },
	{ name: "edit", annotations: { readOnlyHint: false, destructiveHint: true } },
	{ name: "bash" },
	{ name: "subagent", annotations: { readOnlyHint: false } },
	{ name: "ask_user_question" },
];

function policy(overrides: Partial<RewindConfig> = {}) {
	const fake = createFakePi({ allTools: POLICY_TOOLS });
	return createSnapshotPolicy(fake.pi, { ...DEFAULT_CONFIG, ...overrides });
}

describe("snapshot policy", () => {
	test("never snapshots structured readers, trackers, or the interactive prompt", () => {
		const subject = policy();
		for (const name of ["read", "grep", "find", "ls", "todo", "goal", "ask_user_question"]) {
			expect(subject.shouldSnapshot(name)).toBe(false);
		}
	});

	test("snapshots mutating, hinted, and unknown tools", () => {
		const subject = policy();
		for (const name of ["write", "edit", "bash", "subagent", "some_mcp_tool"]) {
			expect(subject.shouldSnapshot(name)).toBe(true);
		}
	});

	test("watch forces a reader to count", () => {
		expect(policy({ watch: ["read"] }).shouldSnapshot("read")).toBe(true);
	});

	test("ignore excludes a mutating tool", () => {
		expect(policy({ ignore: ["bash"] }).shouldSnapshot("bash")).toBe(false);
	});
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("operation queue", () => {
	test("runs operations in enqueue order when a later one is ready first", async () => {
		const queue = createOperationQueue();
		const order: string[] = [];
		const gate = deferred();

		const first = queue.enqueue(async () => {
			await gate.promise;
			order.push("first");
		});
		const second = queue.enqueue(async () => {
			order.push("second");
		});
		// The second operation is ready immediately; only the queue may hold it
		// back until the first one finishes.
		gate.resolve();
		await Promise.all([first, second]);

		expect(order).toEqual(["first", "second"]);
	});

	test("a rejected operation rejects its caller without breaking the chain", async () => {
		const queue = createOperationQueue();
		const order: string[] = [];

		await expect(
			queue.enqueue(async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		await queue.enqueue(async () => {
			order.push("next");
		});

		expect(order).toEqual(["next"]);
	});

	test("returns the operation's value", async () => {
		const queue = createOperationQueue();

		await expect(queue.enqueue(async () => 42)).resolves.toBe(42);
	});
});

describe("snapshot metadata", () => {
	test("refFor and idFromRef round-trip under one namespace", () => {
		expect(refFor(NS, "abc")).toBe(`${NS}/abc`);
		expect(idFromRef(NS, `${NS}/abc`)).toBe("abc");
		expect(idFromRef(NS, "refs/heads/main")).toBeUndefined();
		expect(idFromRef(NS, `${NS}/`)).toBeUndefined();
	});

	test("encode and parse keep the prompt, session, and conversation anchor", () => {
		const parsed = parseMessage(encodeMessage(meta({ prompt: "fix the list", entryId: "e1" })));

		expect(parsed?.id).toBe("x");
		expect(parsed?.prompt).toBe("fix the list");
		expect(parsed?.sessionId).toBe("session-1");
		expect(parsed?.entryId).toBe("e1");
	});

	test("keeps braces in the prompt from breaking the JSON scan", () => {
		expect(parseMessage(encodeMessage(meta({ prompt: "a } b" })))?.prompt).toBe("a } b");
	});

	test("rejects a missing, malformed, or incomplete metadata line", () => {
		expect(parseMessage("snapshot x\n\nno metadata here")).toBeUndefined();
		expect(parseMessage("pi-rewind: { not json")).toBeUndefined();
		expect(parseMessage(`pi-rewind: ${JSON.stringify({ id: "x" })}`)).toBeUndefined();
		expect(parseMessage(`pi-rewind: ${JSON.stringify(meta({ reason: "bogus" as never }))}`)).toBeUndefined();
		expect(parseMessage(`pi-rewind: ${JSON.stringify(meta({ prompt: 5 as never }))}`)).toBeUndefined();
		expect(parseMessage(`pi-rewind: ${JSON.stringify(meta({ sessionId: 5 as never }))}`)).toBeUndefined();
	});

	test("rejects an older schema version", () => {
		const { v: _v, ...v1 } = meta();

		expect(parseMessage(`pi-rewind: ${JSON.stringify(v1)}`)).toBeUndefined();
		expect(parseMessage(`pi-rewind: ${JSON.stringify(meta({ v: 2 }))}`)).toBeUndefined();
	});

	test("belongsToRoot compares the recorded root", () => {
		expect(belongsToRoot({ root: "/repo" }, "/repo")).toBe(true);
		expect(belongsToRoot({ root: "/repo" }, "/elsewhere")).toBe(false);
	});
});

function runHarness(config: Partial<RewindConfig> = {}, overrides: Partial<RewindRuntime> = {}) {
	const fake = createFakePi();
	const ctx = makeCtx(fake, { cwd: "/repo", branch: branchWithUser() });
	const snapshots: SnapshotOptions[] = [];
	let invalidated = 0;
	let status = 0;

	const runtime: RewindRuntime = {
		rootFor: async () => "/repo",
		configFor: () => ({ ...DEFAULT_CONFIG, ...config }),
		snapshot: async (_ctx, options): Promise<Snapshot> => {
			snapshots.push(options);
			return makeSnapshot({ id: `s${snapshots.length}`, reason: options.reason, prompt: options.prompt });
		},
		list: async () => [],
		plan: async () => ({ ok: false, reason: "not used" }),
		patch: async () => "",
		numStat: async () => new Map(),
		headTree: async () => undefined,
		restore: async () => {
			throw new Error("not used");
		},
		revertHunks: async () => ({}),
		setStatus: async () => {
			status += 1;
		},
		clearStatus: () => {},
		invalidate: () => {
			invalidated += 1;
		},
		releaseIndexes: () => {},
		sweepStaleIndexes: async () => {},
		...overrides,
	};

	return {
		run: createSnapshotRun(fake.pi, runtime),
		runtime,
		ctx,
		snapshots,
		invalidated: () => invalidated,
		status: () => status,
	};
}

describe("per-run snapshot state", () => {
	test("takes one snapshot for the run, before the first mutating call", async () => {
		const harness = runHarness();

		await harness.run.beginRun("  fix   the list\nmore detail", harness.ctx);
		await harness.run.onToolCall("write", harness.ctx);
		await harness.run.onToolCall("edit", harness.ctx);

		expect(harness.snapshots).toEqual([{ reason: "auto", prompt: "fix the list" }]);
		expect(harness.status()).toBe(1);
	});

	test("snapshots nothing for a read-only call", async () => {
		const harness = runHarness();

		await harness.run.beginRun("read the list", harness.ctx);
		await harness.run.onToolCall("read", harness.ctx);

		expect(harness.snapshots).toEqual([]);
	});

	test("snapshots nothing when automatic snapshots are off", async () => {
		const harness = runHarness({ autoSnapshots: false });

		await harness.run.beginRun("task", harness.ctx);
		await harness.run.onToolCall("write", harness.ctx);

		expect(harness.snapshots).toEqual([]);
	});

	test("snapshots nothing when the run has no repository root", async () => {
		const harness = runHarness({}, { rootFor: async () => undefined });

		await harness.run.beginRun("task", harness.ctx);
		await harness.run.onToolCall("write", harness.ctx);

		expect(harness.snapshots).toEqual([]);
	});

	test("snapshots a run with no prompt, without a summary", async () => {
		const harness = runHarness();

		await harness.run.beginRun(undefined, harness.ctx);
		await harness.run.onToolCall("write", harness.ctx);

		expect(harness.snapshots).toEqual([{ reason: "auto", prompt: undefined }]);
	});

	test("a failed snapshot warns once and a later call retries the claim", async () => {
		const harness = runHarness();
		let failing = true;
		harness.runtime.snapshot = async (_ctx, options) => {
			harness.snapshots.push(options);
			if (failing) throw new Error("git failed");
			return makeSnapshot();
		};

		await harness.run.beginRun("task", harness.ctx);
		await harness.run.onToolCall("write", harness.ctx);
		await harness.run.onToolCall("edit", harness.ctx);
		failing = false;
		await harness.run.onToolCall("edit", harness.ctx);

		expect(harness.snapshots).toHaveLength(3);
		expect(harness.ctx.notices.filter((notice: { kind?: string }) => notice.kind === "warning")).toHaveLength(1);
		expect(harness.status()).toBe(1);
	});

	test("refresh drops caches and run state, then repaints the status", async () => {
		const harness = runHarness();
		await harness.run.beginRun("task", harness.ctx);

		await harness.run.refresh(harness.ctx);
		await harness.run.onToolCall("write", harness.ctx);

		expect(harness.invalidated()).toBe(1);
		expect(harness.status()).toBe(1);
		expect(harness.snapshots).toEqual([]);
	});

	test("reset drops the run so a later call snapshots nothing", async () => {
		const harness = runHarness();
		await harness.run.beginRun("task", harness.ctx);

		harness.run.reset();
		await harness.run.onToolCall("write", harness.ctx);

		expect(harness.snapshots).toEqual([]);
	});
});

describe.skipIf(!runSlowSuites)("temporary index lifecycle", () => {
	test("pathFor creates the pi dir and returns a stable per-process path", async () => {
		const repo = await makeRepo("pi-rw-index-path-");
		cleanups.push(repo);
		const store = createTempIndexStore(runGit);

		const first = await store.pathFor(repo);

		expect(first).toBe(join(repo, ".git", "pi", `rewind-index-${process.pid}`));
		expect(existsSync(dirname(first))).toBe(true);
		expect(await store.pathFor(repo)).toBe(first);
	});

	test("release deletes the files it created but keeps the directory", async () => {
		const repo = await makeRepo("pi-rw-index-release-");
		cleanups.push(repo);
		const store = createTempIndexStore(runGit);

		const file = await store.pathFor(repo);
		// git creates this file on the first stage.
		writeFileSync(file, "");
		store.release();

		expect(existsSync(file)).toBe(false);
		expect(await store.pathFor(repo)).toBe(file);
	});

	test("sweep removes stale indexes but keeps the live, recent, and unrelated files", async () => {
		const repo = await makeRepo("pi-rw-index-sweep-");
		cleanups.push(repo);
		const dir = join(repo, ".git", "pi");
		mkdirSync(dir, { recursive: true });

		const oldSeconds = 1_000_000;
		const stale = [join(dir, "rewind-index-999999"), join(dir, "checkpoint-index-999999")];
		const recent = join(dir, "rewind-index-999998");
		const own = join(dir, `rewind-index-${process.pid}`);
		const unrelated = join(dir, "other-file");
		for (const file of [...stale, recent, own, unrelated]) writeFileSync(file, "");
		for (const file of stale) utimesSync(file, oldSeconds, oldSeconds);
		// Old, but it belongs to this process and must survive.
		utimesSync(own, oldSeconds, oldSeconds);

		await createTempIndexStore(runGit).sweep(repo);

		expect(existsSync(stale[0])).toBe(false);
		expect(existsSync(stale[1])).toBe(false);
		expect(existsSync(recent)).toBe(true);
		expect(existsSync(own)).toBe(true);
		expect(existsSync(unrelated)).toBe(true);
	});

	test("sweep outside a repository is a no-op", async () => {
		const outside = mkdtempSync(join(tmpdir(), "pi-rw-index-nogit-"));
		cleanups.push(outside);

		await expect(createTempIndexStore(runGit).sweep(outside)).resolves.toBeUndefined();
	});
});

describe.skipIf(!runSlowSuites)("ref-backed snapshot storage", () => {
	test("lists newest first and filters to the current root", async () => {
		const repo = await makeRepo("pi-rw-store-");
		cleanups.push(repo);
		await createSnapshot({ runGit, now: () => 1000, idFactory: () => "a" }, snapshotInput(repo));
		await createSnapshot({ runGit, now: () => 2000, idFactory: () => "b" }, snapshotInput(repo));
		// A valid snapshot from another root, to exercise the worktree filter.
		const head = (await revParse(runGit, repo, "HEAD")) as string;
		const tree = (await revParse(runGit, repo, "HEAD^{tree}")) as string;
		const foreign = await commitTree(
			runGit,
			repo,
			tree,
			head,
			encodeMessage(meta({ id: "foreign", root: "/elsewhere", head, timestamp: 3000 })),
		);
		await updateRef(runGit, repo, refFor(NS, "foreign"), foreign);

		const all = await listSnapshots(runGit, repo, NS);
		const scoped = await listSnapshots(runGit, repo, NS, { root: repo });

		expect(all.map((snapshot) => snapshot.id)).toEqual(["foreign", "b", "a"]);
		expect(scoped.map((snapshot) => snapshot.id)).toEqual(["b", "a"]);
	});

	test("prunes the oldest beyond max for a root", async () => {
		const repo = await makeRepo("pi-rw-prune-");
		cleanups.push(repo);
		for (const [time, id] of [
			[1000, "p1"],
			[2000, "p2"],
			[3000, "p3"],
		] as const) {
			await createSnapshot({ runGit, now: () => time, idFactory: () => id }, snapshotInput(repo));
		}

		expect(await pruneSnapshots(runGit, repo, NS, 2, repo)).toBe(1);
		const remaining = await listSnapshots(runGit, repo, NS, { root: repo });
		expect(remaining.map((snapshot) => snapshot.id)).toEqual(["p3", "p2"]);
	});

	test("counts a pre-restore safety snapshot in the same budget", async () => {
		const repo = await makeRepo("pi-rw-prune-safety-");
		cleanups.push(repo);
		await createSnapshot({ runGit, now: () => 1000, idFactory: () => "auto-1" }, snapshotInput(repo));
		await createSnapshot(
			{ runGit, now: () => 2000, idFactory: () => "safety-1" },
			snapshotInput(repo, { reason: "pre-restore" }),
		);

		// The safety snapshot is not a free extra: a budget of two keeps both.
		expect(await pruneSnapshots(runGit, repo, NS, 2, repo)).toBe(0);
		// A budget of one drops the older automatic snapshot and keeps the newer,
		// more useful undo point.
		expect(await pruneSnapshots(runGit, repo, NS, 1, repo)).toBe(1);
		const remaining = await listSnapshots(runGit, repo, NS, { root: repo });
		expect(remaining.map((snapshot) => snapshot.id)).toEqual(["safety-1"]);
	});

	test("deleteSnapshots removes the listed refs", async () => {
		const repo = await makeRepo("pi-rw-prune-delete-");
		cleanups.push(repo);
		await createSnapshot({ runGit, now: () => 1000, idFactory: () => "d1" }, snapshotInput(repo));
		await createSnapshot({ runGit, now: () => 2000, idFactory: () => "d2" }, snapshotInput(repo));

		const snapshots = await listSnapshots(runGit, repo, NS, { root: repo });

		expect(await deleteSnapshots(runGit, repo, snapshots)).toBe(2);
		expect(await listSnapshots(runGit, repo, NS)).toEqual([]);
	});
});

describe.skipIf(!runSlowSuites)("snapshot creation", () => {
	test("captures tracked modifications and untracked files", async () => {
		const repo = await makeRepo("pi-rw-snap-");
		cleanups.push(repo);
		writeFileSync(join(repo, "README.md"), "changed\n");
		writeFileSync(join(repo, "new.txt"), "new\n");

		const snapshot = await createSnapshot({ runGit, now: () => 1000, idFactory: () => "t-dirty" }, snapshotInput(repo));

		expect(snapshot.id).toBe("t-dirty");
		expect(snapshot.clean).toBe(false);
		expect(snapshot.branch).toBe("main");
		expect(snapshot.ref).toBe(`${NS}/t-dirty`);
		expect((await runGit(["cat-file", "-e", `${snapshot.commit}:new.txt`], { cwd: repo })).code).toBe(0);
		expect((await runGit(["show", `${snapshot.commit}:README.md`], { cwd: repo })).stdout).toBe("changed\n");
	});

	test("records a metadata commit sharing HEAD's tree when the tree is clean", async () => {
		const repo = await makeRepo("pi-rw-snap-clean-");
		cleanups.push(repo);

		const snapshot = await createSnapshot({ runGit, now: () => 2000, idFactory: () => "t-clean" }, snapshotInput(repo));

		expect(snapshot.clean).toBe(true);
		// git reuses the identical tree object; only a small commit is added.
		const tree = (await runGit(["rev-parse", `${snapshot.commit}^{tree}`], { cwd: repo })).stdout.trim();
		const headTree = (await runGit(["rev-parse", "HEAD^{tree}"], { cwd: repo })).stdout.trim();
		expect(tree).toBe(headTree);
		expect(snapshot.commit).not.toBe(snapshot.head);
	});

	test("excludes ignored files but captures .gitignore itself", async () => {
		const repo = await makeRepo("pi-rw-snap-ignore-");
		cleanups.push(repo);
		writeFileSync(join(repo, ".gitignore"), "ignored.txt\n");
		writeFileSync(join(repo, "ignored.txt"), "secret\n");

		const snapshot = await createSnapshot(
			{ runGit, now: () => 3000, idFactory: () => "t-ignore" },
			snapshotInput(repo),
		);

		expect((await runGit(["cat-file", "-e", `${snapshot.commit}:ignored.txt`], { cwd: repo })).code).not.toBe(0);
		expect((await runGit(["cat-file", "-e", `${snapshot.commit}:.gitignore`], { cwd: repo })).code).toBe(0);
	});

	test("leaves the real index and HEAD untouched", async () => {
		const repo = await makeRepo("pi-rw-snap-index-");
		cleanups.push(repo);
		writeFileSync(join(repo, "staged.txt"), "staged\n");
		await runGit(["add", "staged.txt"], { cwd: repo });
		const stagedBefore = await runGit(["diff", "--cached", "--name-only"], { cwd: repo });
		const headBefore = await runGit(["rev-parse", "HEAD"], { cwd: repo });

		await createSnapshot({ runGit, now: () => 4000, idFactory: () => "t-index" }, snapshotInput(repo));

		expect((await runGit(["diff", "--cached", "--name-only"], { cwd: repo })).stdout).toBe(stagedBefore.stdout);
		expect((await runGit(["rev-parse", "HEAD"], { cwd: repo })).stdout).toBe(headBefore.stdout);
	});

	test("records the prompt summary, session, and conversation anchor", async () => {
		const repo = await makeRepo("pi-rw-snap-prompt-");
		cleanups.push(repo);

		const snapshot = await createSnapshot(
			{ runGit, now: () => 5000, idFactory: () => "t-prompt" },
			snapshotInput(repo, { prompt: "fix the list", sessionId: "session-9", entryId: "entry-7" }),
		);

		expect(snapshot.prompt).toBe("fix the list");
		expect(snapshot.sessionId).toBe("session-9");
		expect(snapshot.entryId).toBe("entry-7");
	});

	test("captures tracked files but no untracked ones when includeUntracked is false", async () => {
		const repo = await makeRepo("pi-rw-snap-excl-");
		cleanups.push(repo);
		writeFileSync(join(repo, "README.md"), "tracked change\n");
		writeFileSync(join(repo, "later.txt"), "untracked\n");

		const snapshot = await createSnapshot(
			{ runGit, now: () => 6000, idFactory: () => "t-excl" },
			snapshotInput(repo, { includeUntracked: false }),
		);

		// A fresh temp index must be seeded from HEAD before `add -u`, or the tree
		// would be empty and the rewind a silent no-op.
		expect((await runGit(["show", `${snapshot.commit}:README.md`], { cwd: repo })).stdout).toBe("tracked change\n");
		expect((await runGit(["cat-file", "-e", `${snapshot.commit}:later.txt`], { cwd: repo })).code).not.toBe(0);
		const tree = (await runGit(["rev-parse", `${snapshot.commit}^{tree}`], { cwd: repo })).stdout.trim();
		expect(tree).not.toBe("4b825dc642cb6eb9a060e54bf8d69288fbee4904");
	});

	test("reads HEAD and its tree in one rev-parse and writes the snapshot in six git calls", async () => {
		const repo = await makeRepo("pi-rw-snap-calls-");
		cleanups.push(repo);
		const calls: string[][] = [];
		const counting: typeof runGit = (args, options) => {
			calls.push(args);
			return runGit(args, options);
		};

		const snapshot = await createSnapshot(
			{ runGit: counting, now: () => 7000, idFactory: () => "t-calls" },
			snapshotInput(repo),
		);

		// Stage, tree, branch, commit, ref — plus one `rev-parse` for HEAD and its
		// tree and one for the branch. A seventh call means the ids were asked for
		// separately again.
		expect(calls).toHaveLength(6);
		expect(calls.filter((args) => args[0] === "rev-parse")).toHaveLength(2);
		expect(snapshot.clean).toBe(true);
		expect(snapshot.branch).toBe("main");
	});

	test("refuses a repository with no commits", async () => {
		const repo = await makeRepo("pi-rw-empty-");
		cleanups.push(repo);
		await runGit(["update-ref", "-d", "HEAD"], { cwd: repo });

		await expect(createSnapshot({ runGit }, snapshotInput(repo))).rejects.toThrow(/no commits/);
	});
});
