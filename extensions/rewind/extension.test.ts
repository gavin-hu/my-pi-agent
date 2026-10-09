import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSnapshot } from "./snapshot.ts";
import { onRailsSuppressed } from "../../lib/rails.ts";
import { createFakePi, emit } from "../../test/helpers/fakes.ts";
import { withEnv } from "../../test/helpers/env.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import rewindExtension from "./index.ts";
import {
	branchWithUser,
	indexFileFor,
	makeCtx,
	rewindMetadata as metadata,
	rewindRefs as refs,
	runGit,
	setupRewind as setup,
} from "../../test/helpers/fixtures/rewind.ts";
import { cleanup, execP, makeRepo } from "../../test/helpers/git.ts";

const cleanups: string[] = [];
afterAll(() => cleanup(...cleanups));

const NS = "refs/pi/rewind";

describe("automatic snapshots", () => {
	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "rewind" }, () => {
			const { pi, commands, handlers } = createFakePi();
			rewindExtension(pi);
			expect(commands.size).toBe(0);
			expect(handlers.size).toBe(0);
		});
	});

	test("takes one snapshot per prompt, before the first mutating call", async () => {
		const repo = await makeRepo("pi-rw-ext-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, branch: branchWithUser() });

		await emit(fake.pi, "session_start", { reason: "startup" }, ctx);
		await emit(fake.pi, "before_agent_start", { type: "before_agent_start", prompt: "do the task" }, ctx);

		writeFileSync(join(repo, "w.txt"), "x\n");
		await emit(fake.pi, "tool_call", { toolName: "write", input: {} }, ctx);
		expect((await refs(repo)).length).toBe(1);

		// A later mutating call in the same prompt takes no further snapshot.
		await emit(fake.pi, "tool_call", { toolName: "edit", input: {} }, ctx);
		expect((await refs(repo)).length).toBe(1);
	});

	test("a new prompt snapshots again", async () => {
		const repo = await makeRepo("pi-rw-ext-prompt2-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, branch: branchWithUser() });
		await emit(fake.pi, "session_start", { reason: "startup" }, ctx);

		await emit(fake.pi, "before_agent_start", { type: "before_agent_start", prompt: "first" }, ctx);
		writeFileSync(join(repo, "w.txt"), "x\n");
		await emit(fake.pi, "tool_call", { toolName: "write", input: {} }, ctx);

		await emit(fake.pi, "before_agent_start", { type: "before_agent_start", prompt: "second" }, ctx);
		await emit(fake.pi, "tool_call", { toolName: "edit", input: {} }, ctx);
		expect((await refs(repo)).length).toBe(2);
	});

	test("the status chip equals the /rewind list size, not the snapshot count", async () => {
		const repo = await makeRepo("pi-rw-ext-chip-");
		cleanups.push(repo);
		const fake = setup();
		const branch = branchWithUser("e1", "do the task");
		const ctx = makeCtx(fake, { cwd: repo, branch, sessionId: "s1" });

		// One branch prompt and no snapshot yet: the chip already counts the
		// prompt, matching the one row `/rewind` would list.
		await emit(fake.pi, "session_start", { reason: "startup" }, ctx);
		expect(ctx.statuses.get("rewind")).toBe("↺ 1");

		await emit(fake.pi, "before_agent_start", { type: "before_agent_start", prompt: "do the task" }, ctx);
		writeFileSync(join(repo, "w.txt"), "x\n");
		await emit(fake.pi, "tool_call", { toolName: "write", input: {} }, ctx);
		expect(ctx.statuses.get("rewind")).toBe("↺ 1");

		// A pre-restore safety snapshot on the same entry is stored, but it is not
		// a rewind point and adds no list row, so it must not inflate the chip.
		await createSnapshot(
			{ runGit },
			{
				root: repo,
				indexFile: indexFileFor(repo),
				namespace: NS,
				reason: "pre-restore",
				includeUntracked: true,
				sessionId: "s1",
				entryId: "e1",
			},
		);
		expect((await refs(repo)).length).toBe(2);

		// A second branch prompt raises the chip to two, matching the two rows
		// `/rewind` would list — not the three stored refs.
		ctx.sessionManager.getBranch = () => [...branch, ...branchWithUser("e2", "and again")];
		await emit(fake.pi, "before_agent_start", { type: "before_agent_start", prompt: "and again" }, ctx);
		await emit(fake.pi, "tool_call", { toolName: "edit", input: {} }, ctx);
		expect(ctx.statuses.get("rewind")).toBe("↺ 2");
		expect((await refs(repo)).length).toBe(3);
	});

	test("the status chip equals the /rewind list size", async () => {
		const repo = await makeRepo("pi-rw-ext-parity-");
		cleanups.push(repo);
		const fake = setup();
		const branch = [...branchWithUser("e1", "first"), ...branchWithUser("e2", "second")];
		const ctx = makeCtx(fake, { cwd: repo, branch, sessionId: "s1" });

		await emit(fake.pi, "session_start", { reason: "startup" }, ctx);
		expect(ctx.statuses.get("rewind")).toBe("↺ 2");

		// Even with no snapshots at all, the headless `/rewind` list reports the
		// same two conversation-only points the chip counts.
		await fake.commands.get("rewind").handler("", ctx);
		const list = ctx.notices.at(-1)?.message ?? "";
		expect(list.split("\n")[0]).toBe("2 prompts (newest first):");
	});

	test("does not snapshot read-only calls", async () => {
		const repo = await makeRepo("pi-rw-ext-read-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, branch: branchWithUser() });
		await emit(fake.pi, "session_start", { reason: "startup" }, ctx);
		await emit(fake.pi, "before_agent_start", { type: "before_agent_start", prompt: "read only" }, ctx);

		await emit(fake.pi, "tool_call", { toolName: "read", input: {} }, ctx);
		expect((await refs(repo)).length).toBe(0);
		// No snapshot, but the prompt still appears in `/rewind`, so it is counted.
		expect(ctx.statuses.get("rewind")).toBe("↺ 1");
	});

	test("records the prompt summary and conversation anchor at schema v3", async () => {
		const repo = await makeRepo("pi-rw-ext-label-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, branch: branchWithUser("entry-9"), sessionId: "session-9" });
		await emit(fake.pi, "session_start", { reason: "startup" }, ctx);
		await emit(
			fake.pi,
			"before_agent_start",
			{ type: "before_agent_start", prompt: "  fix   the list\nmore detail" },
			ctx,
		);

		writeFileSync(join(repo, "w.txt"), "x\n");
		await emit(fake.pi, "tool_call", { toolName: "write", input: {} }, ctx);

		const [meta] = await metadata(repo);
		expect(meta.prompt).toBe("fix the list");
		expect(meta.v).toBe(3);
		expect(meta.sessionId).toBe("session-9");
		expect(meta.entryId).toBe("entry-9");
	});

	test("autoSnapshots false disables automatic snapshots", async () => {
		const repo = await makeRepo("pi-rw-ext-off-");
		cleanups.push(repo);
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(repo, ".pi", "rewind.json"), JSON.stringify({ autoSnapshots: false }));
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, branch: branchWithUser() });
		await emit(fake.pi, "session_start", { reason: "startup" }, ctx);
		await emit(fake.pi, "before_agent_start", { type: "before_agent_start", prompt: "task" }, ctx);

		writeFileSync(join(repo, "w.txt"), "x\n");
		await emit(fake.pi, "tool_call", { toolName: "write", input: {} }, ctx);
		expect((await refs(repo)).length).toBe(0);
	});

	test("a snapshot failure warns and never blocks the tool call", async () => {
		const repo = mkdtempSync(join(tmpdir(), "pi-rw-nocommit-"));
		cleanups.push(repo);
		await execP("git", ["init", "-q", "-b", "main"], { cwd: repo });
		await execP("git", ["config", "core.autocrlf", "false"], { cwd: repo });
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, branch: branchWithUser() });
		await emit(fake.pi, "session_start", { reason: "startup" }, ctx);
		await emit(fake.pi, "before_agent_start", { type: "before_agent_start", prompt: "task" }, ctx);

		// Must resolve, not reject, and must notify once.
		await emit(fake.pi, "tool_call", { toolName: "write", input: {} }, ctx);
		expect(ctx.notices.some((notice: { kind?: string }) => notice.kind === "warning")).toBe(true);
	});

	test("registers the /rewind command and no others", () => {
		const fake = setup();
		expect(fake.commands.has("rewind")).toBe(true);
		expect(fake.commands.has("checkpoint")).toBe(false);
	});

	test("/rewind hides the rails while the picker is open", async () => {
		const repo = await makeRepo("pi-rw-rail-");
		cleanups.push(repo);
		const fake = setup();
		const events: boolean[] = [];
		onRailsSuppressed(fake.pi, (suppressed) => events.push(suppressed));
		const ctx = makeCtx(fake, { cwd: repo, hasUI: true, mode: "tui", branch: branchWithUser() });

		await fake.commands.get("rewind").handler("", ctx);

		expect(events).toEqual([true, false]);
	});
});

describe("temp index lifecycle", () => {
	test("session shutdown removes this process's temp index", async () => {
		const repo = await makeRepo("pi-rw-index-shutdown-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, branch: branchWithUser() });

		await emit(fake.pi, "session_start", { reason: "startup" }, ctx);
		await emit(fake.pi, "before_agent_start", { type: "before_agent_start", prompt: "task" }, ctx);
		writeFileSync(join(repo, "w.txt"), "x\n");
		await emit(fake.pi, "tool_call", { toolName: "write", input: {} }, ctx);

		const index = join(repo, ".git", "pi", `rewind-index-${process.pid}`);
		expect(existsSync(index)).toBe(true);

		await emit(fake.pi, "session_shutdown", { reason: "quit" }, ctx);
		expect(existsSync(index)).toBe(false);
	});

	test("session start sweeps stale indexes but keeps the live one", async () => {
		const repo = await makeRepo("pi-rw-index-sweep-");
		cleanups.push(repo);
		const dir = join(repo, ".git", "pi");
		mkdirSync(dir, { recursive: true });
		const stale = [join(dir, "rewind-index-999999"), join(dir, "checkpoint-index-999999")];
		const live = join(dir, `rewind-index-${process.pid}`);
		const oldSeconds = 1_000_000;
		for (const file of [...stale, live]) {
			writeFileSync(file, "");
			utimesSync(file, oldSeconds, oldSeconds);
		}
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, branch: branchWithUser() });

		await emit(fake.pi, "session_start", { reason: "startup" }, ctx);

		expect(existsSync(stale[0])).toBe(false);
		expect(existsSync(stale[1])).toBe(false);
		expect(existsSync(live)).toBe(true);
	});
});
