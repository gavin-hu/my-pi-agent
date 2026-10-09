import { afterAll, describe, expect, test } from "bun:test";
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

const cleanups: string[] = [];
afterAll(() => cleanup(...cleanups));

const setup = () => setupRewind([WRITE_TOOL]);

describe("/rewind command", () => {
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
