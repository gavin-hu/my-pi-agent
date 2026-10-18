import { afterAll, describe, expect, test } from "bun:test";
import { runSlowSuites } from "../../test/helpers/slow-suite.ts";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	answerScope as answer,
	branchWithUser,
	makeCtx,
	primeRewind as prime,
	setupRewind,
	WRITE_TOOL,
} from "../../test/helpers/fixtures/rewind.ts";
import { cleanup, makeRepo } from "../../test/helpers/git.ts";
import { choosePaths } from "./rewind.ts";

const cleanups: string[] = [];
afterAll(() => cleanup(...cleanups));

const setup = () => setupRewind([WRITE_TOOL]);

describe.skipIf(!runSlowSuites)("/rewind command", () => {
	test("conversation-only moves the session and leaves files alone", async () => {
		const repo = await makeRepo("pi-rw-cmd-talk-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, hasUI: true, mode: "rpc", branch: branchWithUser("e1"), sessionId: "s1" });
		await prime(fake, ctx);

		ctx.ui.select = answer("Conversation only");
		await fake.commands.get("rewind").handler("", ctx);

		expect(ctx.navigations).toEqual(["e1"]);
		expect(existsSync(join(repo, "after.txt"))).toBe(true);
	});

	test("code-only restores files and does not navigate", async () => {
		const repo = await makeRepo("pi-rw-cmd-code-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, hasUI: true, mode: "rpc", branch: branchWithUser("e1"), sessionId: "s1" });
		await prime(fake, ctx);

		ctx.ui.select = answer("Code only");
		await fake.commands.get("rewind").handler("", ctx);

		expect(ctx.navigations).toEqual([]);
		expect(existsSync(join(repo, "after.txt"))).toBe(false);
	});

	test("both restores files and then navigates", async () => {
		const repo = await makeRepo("pi-rw-cmd-both-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, hasUI: true, mode: "rpc", branch: branchWithUser("e1"), sessionId: "s1" });
		await prime(fake, ctx);

		ctx.ui.select = answer("Code and conversation");
		await fake.commands.get("rewind").handler("", ctx);

		expect(ctx.navigations).toEqual(["e1"]);
		expect(existsSync(join(repo, "after.txt"))).toBe(false);
	});

	test("works outside a git repository for conversation only", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-rw-cmd-nogit-"));
		cleanups.push(dir);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: dir, hasUI: true, mode: "rpc", branch: branchWithUser("e1"), sessionId: "s1" });

		ctx.ui.select = answer("Conversation only");
		await fake.commands.get("rewind").handler("", ctx);

		expect(ctx.navigations).toEqual(["e1"]);
	});

	test("lists prompts headlessly without a picker", async () => {
		const repo = await makeRepo("pi-rw-cmd-headless-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, hasUI: false, branch: branchWithUser("e1"), sessionId: "s1" });

		await fake.commands.get("rewind").handler("", ctx);
		expect(ctx.notices.at(-1).message).toContain("1 prompt (newest first)");
	});

	test("reports an empty timeline", async () => {
		const repo = await makeRepo("pi-rw-cmd-empty-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, hasUI: true, mode: "rpc", branch: [], sessionId: "s1" });

		await fake.commands.get("rewind").handler("", ctx);
		expect(ctx.notices.at(-1).message).toContain("No prompts to rewind to yet.");
	});

	test("restores the prompt to the editor when the target is already the leaf", async () => {
		const repo = await makeRepo("pi-rw-cmd-leaf-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, {
			cwd: repo,
			hasUI: true,
			mode: "rpc",
			branch: branchWithUser("e1"),
			sessionId: "s1",
			leafId: "e1",
		});
		await prime(fake, ctx);

		ctx.ui.select = answer("Conversation only");
		await fake.commands.get("rewind").handler("", ctx);

		// navigateTree is a no-op at the leaf, so the prompt is set manually.
		expect(ctx.navigations).toEqual(["e1"]);
		expect(ctx.editorSets).toEqual(["do the task"]);
	});
});

// Not gated on the slow suite: the path step decides what to restore, and it never
// touches git.
describe("/rewind path step", () => {
	const changed = [
		{ path: "a.txt", change: "modified" as const },
		{ path: "src/b.txt", change: "added" as const },
	];

	test("non-TUI modes restore everything without mounting a screen", async () => {
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: "/tmp", hasUI: true, mode: "rpc" });
		let mounted = 0;
		ctx.ui.custom = async () => {
			mounted += 1;
			return undefined;
		};

		expect(await choosePaths(fake.pi, ctx, changed)).toEqual({ kind: "all" });
		expect(mounted).toBe(0);
	});

	test("an empty diff has nothing to choose", async () => {
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: "/tmp", hasUI: true, mode: "tui" });

		expect(await choosePaths(fake.pi, ctx, [])).toEqual({ kind: "all" });
	});

	test("offers the whole diff first and cancels when the dialog is dismissed", async () => {
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: "/tmp", hasUI: true, mode: "tui" });
		const titles: string[] = [];
		ctx.ui.select = async (title: string) => {
			titles.push(title);
			return undefined;
		};

		expect(await choosePaths(fake.pi, ctx, changed)).toEqual({ kind: "cancel" });
		expect(titles[0]).toBe("Restore what?");
	});

	test("takes the whole diff from the first answer", async () => {
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: "/tmp", hasUI: true, mode: "tui" });
		ctx.ui.select = async () => "Everything (2 files)";

		expect(await choosePaths(fake.pi, ctx, changed)).toEqual({ kind: "all" });
	});

	test("mounts the checklist and returns the paths it reports", async () => {
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: "/tmp", hasUI: true, mode: "tui" });
		ctx.ui.select = async () => "Choose paths…";
		ctx.ui.custom = async () => ["src/b.txt"];

		expect(await choosePaths(fake.pi, ctx, changed)).toEqual({ kind: "some", paths: ["src/b.txt"] });
	});

	test("a cancelled checklist cancels the rewind", async () => {
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: "/tmp", hasUI: true, mode: "tui" });
		ctx.ui.select = async () => "Choose paths…";
		ctx.ui.custom = async () => undefined;

		expect(await choosePaths(fake.pi, ctx, changed)).toEqual({ kind: "cancel" });
	});
});
