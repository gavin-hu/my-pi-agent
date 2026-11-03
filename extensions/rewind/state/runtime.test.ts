import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { isoTime } from "../../../test/helpers/entries.ts";
import { tempDir, useEnv, withAgentDir } from "../../../test/helpers/env.ts";
import { createFakePi, fakeTheme } from "../../../test/helpers/fakes.ts";
import {
	answerScope as answer,
	branchWithUser,
	cleanup,
	execP,
	indexFileFor,
	makeCtx,
	makeRepo,
	makeSnapshot,
	primeRewind,
	rewindMetadata,
	rewindRefs,
	runGit,
	setupRewind,
	snapshotInput,
	WRITE_TOOL,
} from "../../../test/helpers/fixtures/rewind.ts";
import { runSlowSuites } from "../../../test/helpers/slow-suite.ts";
import { DEFAULT_CONFIG } from "../config/config.ts";
import {
	formatChangeSummary,
	formatRelativeTime,
	formatRestoreText,
	formatRewindDetail,
	formatRewindListText,
	formatRewindParts,
	formatRewindRow,
	previewDiffText,
	PROMPT_WIDTH,
	summarizePrompt,
} from "../text/format.ts";
import { busyGitState, diffStat, nameStatus, restorePaths, treeFromWorkingTree } from "../transport/git.ts";
import { applyRestore, planRestore } from "../transport/restore.ts";
import { choosePaths } from "../commands/rewind.ts";
import { RewindListComponent, type RewindListOptions } from "../view/rewind-tui.ts";
import { createRuntime, type RewindRuntime } from "./runtime.ts";
import { createSnapshot } from "../transport/snapshot.ts";
import {
	buildRewindPoints,
	lastUserEntryId,
	messageText,
	rewindScopes,
	userMessagesFromBranch,
	type RewindPoint,
} from "./timeline.ts";

const cleanups: string[] = [];
afterAll(() => cleanup(...cleanups));

function userEntry(id: string, content: unknown, timestamp = 1000): any {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: isoTime(timestamp),
		message: { role: "user", content, timestamp },
	};
}

function assistantEntry(id: string): any {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: isoTime(1000),
		message: { role: "assistant", content: [{ type: "text", text: "ok" }], timestamp: 1000 },
	};
}

describe("rewind timeline", () => {
	test("flattens text blocks and ignores images", () => {
		expect(messageText("hello")).toBe("hello");
		expect(
			messageText([
				{ type: "text", text: "one" },
				{ type: "image", data: "x", mimeType: "image/png" },
				{ type: "text", text: "two" },
			]),
		).toBe("one\ntwo");
		expect(messageText([{ type: "image", data: "x", mimeType: "image/png" }])).toBe("");
	});

	test("finds the last user entry on the branch", () => {
		const branch = [userEntry("e1", "first"), assistantEntry("a1"), userEntry("e2", "second")];

		expect(lastUserEntryId(branch)).toBe("e2");
		expect(lastUserEntryId([assistantEntry("a1")])).toBeNull();
	});

	test("extracts only user messages, in branch order", () => {
		const branch = [userEntry("e1", "first", 1000), assistantEntry("a1"), userEntry("e2", "second", 2000)];

		expect(userMessagesFromBranch(branch)).toEqual([
			{ entryId: "e1", text: "first", timestamp: 1000 },
			{ entryId: "e2", text: "second", timestamp: 2000 },
		]);
	});

	const branch = [userEntry("e1", "first", 1000), assistantEntry("a1"), userEntry("e2", "second", 2000)];

	test("pairs an auto snapshot by entry and session, newest first", () => {
		const points = buildRewindPoints(branch, [makeSnapshot({ id: "s1", entryId: "e1" })], "sess");

		expect(points.map((point) => point.entryId)).toEqual(["e2", "e1"]);
		expect(points[1].snapshot?.id).toBe("s1");
		expect(points[0].snapshot).toBeUndefined();
		expect(points[1].summary).toBe("first");
	});

	test("ignores a snapshot from another session, another reason, or no anchor", () => {
		const snapshots = [
			makeSnapshot({ id: "other-session", entryId: "e1", sessionId: "else" }),
			makeSnapshot({ id: "safety", entryId: "e1", reason: "pre-restore" }),
			makeSnapshot({ id: "unanchored", entryId: null }),
		];

		const points = buildRewindPoints(branch, snapshots, "sess");

		expect(points.every((point) => point.snapshot === undefined)).toBe(true);
	});

	test("keeps the earliest snapshot when several share an anchor", () => {
		const snapshots = [
			makeSnapshot({ id: "later", entryId: "e1", timestamp: 2000 }),
			makeSnapshot({ id: "earlier", entryId: "e1", timestamp: 500 }),
		];

		const [e2, e1] = buildRewindPoints(branch, snapshots, "sess");

		expect(e1.snapshot?.id).toBe("earlier");
		expect(e2.snapshot).toBeUndefined();
	});

	test("offers code choices only when a snapshot exists", () => {
		const withCode: RewindPoint = { entryId: "e", prompt: "p", summary: "p", timestamp: 0, snapshot: makeSnapshot() };
		const talkOnly: RewindPoint = { entryId: "e", prompt: "p", summary: "p", timestamp: 0 };

		expect(rewindScopes(withCode)).toEqual(["both", "conversation", "code"]);
		expect(rewindScopes(talkOnly)).toEqual(["conversation"]);
	});
});

describe("rewind formatting", () => {
	const now = 1_000_000;

	test("scales a relative time from seconds to days", () => {
		expect(formatRelativeTime(now - 3_000, now)).toBe("3s ago");
		expect(formatRelativeTime(now - 120_000, now)).toBe("2m ago");
		expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
		expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
	});

	test("summarizes the first non-empty prompt line and collapses whitespace", () => {
		expect(summarizePrompt("  \n  fix the   list\t\nmore detail")).toBe("fix the list");
		expect(summarizePrompt("\n\n")).toBeUndefined();
		expect(summarizePrompt("")).toBeUndefined();
		expect(summarizePrompt(undefined)).toBeUndefined();
	});

	test("truncates a long prompt summary to the storage width", () => {
		const summary = summarizePrompt("x".repeat(PROMPT_WIDTH + 20));

		expect(summary).toBeDefined();
		expect(visibleWidth(summary as string)).toBeLessThanOrEqual(PROMPT_WIDTH);
		expect((summary as string).endsWith("…")).toBe(true);
	});

	test("parts a timeline row into its marker, label, and age", () => {
		const parts = formatRewindParts("fix the list", true, 1000, 2000);

		expect(parts.glyph).toBe(GLYPHS.snapshot);
		expect(parts.label).toBe("fix the list");
		expect(parts.trailing).toBe("1s ago");
		expect(formatRewindParts(undefined, false, 0, 0).label).toBe("(no text)");
		expect(formatRewindParts(undefined, false, 0, 0).glyph).not.toBe(GLYPHS.snapshot);
	});

	test("formats a width-safe row with a snapshot marker and the age at the end", () => {
		const marked = formatRewindRow("fix the list", true, now - 120_000, now, 40);
		const plain = formatRewindRow("explain this", false, now - 3_000, now, 40);
		const narrow = formatRewindRow("x".repeat(200), true, now, now, 12);

		expect(marked.startsWith(`${GLYPHS.snapshot} `)).toBe(true);
		expect(marked).toContain("fix the list");
		expect(marked).toMatch(/2m ago$/);
		expect(visibleWidth(marked)).toBeLessThanOrEqual(40);
		expect(plain.startsWith(GLYPHS.snapshot)).toBe(false);
		expect(plain).toContain("explain this");
		expect(formatRewindRow(undefined, false, now, now, 40)).toContain("(no text)");
		expect(visibleWidth(narrow)).toBeLessThanOrEqual(12);
	});

	test("describes the focused point's code state", () => {
		expect(formatRewindDetail(false)).toBe("conversation only");
		expect(formatRewindDetail(true, "abc")).toBe("code snapshot #abc");
		expect(formatRewindDetail(true)).toBe("code snapshot");
	});

	test("lists prompts newest first, or reports an empty timeline", () => {
		const text = formatRewindListText([
			{ summary: "second", timestamp: 2000, hasSnapshot: true },
			{ summary: "first", timestamp: 1000, hasSnapshot: false },
		]);

		expect(formatRewindListText([])).toContain("No prompts to rewind to yet.");
		expect(text).toContain("2 prompts (newest first):");
		expect(text.split("\n")[1]).toContain("second");
		expect(text.split("\n")[1]).toContain(GLYPHS.snapshot);
		expect(text.split("\n")[2]).not.toContain(GLYPHS.snapshot);
	});

	test("bounds a long diff preview and leaves a short one alone", () => {
		const diff = Array.from({ length: 30 }, (_, index) => `line ${index}`).join("\n");
		const preview = previewDiffText(diff, 5);

		expect(preview.split("\n")).toHaveLength(6);
		expect(preview).toContain("25 more lines");
		expect(previewDiffText("a\nb", 5)).toBe("a\nb");
	});

	test("summarizes a change set and a partial restore", () => {
		expect(formatChangeSummary(1, 0)).toBe("1 file changed");
		expect(formatChangeSummary(2, 1)).toBe("2 files changed, 1 created");
		expect(formatRestoreText({ id: "z", commit: "c", root: "/r", changed: 1, removed: 0, of: 5 })).toContain(
			"1 of 5 files changed",
		);
		expect(formatRestoreText({ id: "z", commit: "c", root: "/r", changed: 2, removed: 1 })).toContain(
			"2 files changed, 1 removed",
		);
		expect(formatRestoreText({ id: "z", commit: "c", root: "/r", changed: 1, removed: 0, safety: "s" })).toContain(
			"safety snapshot #s",
		);
	});
});

const POINTS: RewindPoint[] = [
	{ entryId: "e1", prompt: "fix the list", summary: "fix the list", timestamp: 1000 },
	{
		entryId: "e2",
		prompt: "add tests",
		summary: "add tests",
		timestamp: 2000,
		snapshot: makeSnapshot({ id: "c2", entryId: "e2" }),
	},
];

function rewindList(overrides: Partial<RewindListOptions> = {}): RewindListComponent {
	return new RewindListComponent({
		points: POINTS,
		theme: fakeTheme,
		onClose: () => {},
		requestRender: () => {},
		...overrides,
	});
}

describe("rewind timeline screen", () => {
	test("renders an empty-state hint", () => {
		expect(rewindList({ points: [] }).render(60).join("\n")).toContain("No prompts on this branch yet.");
	});

	test("closes with no point on Escape", () => {
		let closed: RewindPoint | undefined | "called" = "called";
		const component = rewindList({ onClose: (point?: RewindPoint) => (closed = point) });

		component.handleInput("\u001b");

		expect(closed).toBeUndefined();
	});

	test("renders prompts, marks code snapshots, and details the focused point", () => {
		const body = rewindList().render(60).join("\n");

		expect(body).toContain("fix the list");
		expect(body).toContain("add tests");
		expect(body).toContain("conversation only");
		expect(body).toContain(GLYPHS.snapshot);
	});

	test("shows the focused point's snapshot id after moving down", () => {
		const component = rewindList();

		component.handleInput("\u001b[B");

		expect(component.render(60).join("\n")).toContain("code snapshot #c2");
	});

	test("keeps every line within very narrow and normal widths", () => {
		const wide = [{ entryId: "e", prompt: "x".repeat(300), summary: "x".repeat(300), timestamp: 1000 }];

		for (const [component, width] of [
			[rewindList(), 40],
			[rewindList({ points: wide }), 24],
			[rewindList(), 6],
		] as const) {
			for (const line of component.render(width)) {
				expect(visibleWidth(line), `${width}: ${line}`).toBeLessThanOrEqual(width);
			}
		}
	});

	test("sizes the window to the terminal height", () => {
		const many: RewindPoint[] = Array.from({ length: 30 }, (_, index) => ({
			entryId: `e${index}`,
			prompt: `prompt ${index}`,
			summary: `prompt ${index}`,
			timestamp: 1000,
		}));

		const short = rewindList({ points: many, viewportRows: 15 }).render(60).join("\n");
		const tall = rewindList({ points: many, viewportRows: 60 }).render(60).join("\n");

		expect(short).toContain("showing 1–6 of 30");
		expect(short).not.toContain("prompt 6");
		expect(tall).toContain("prompt 29");
		expect(tall).not.toContain("showing");
	});

	test("scrolls the window as the cursor moves", () => {
		const many: RewindPoint[] = Array.from({ length: 30 }, (_, index) => ({
			entryId: `e${index}`,
			prompt: `prompt ${index}`,
			summary: `prompt ${index}`,
			timestamp: 1000,
		}));
		let renders = 0;
		const component = rewindList({ points: many, requestRender: () => renders++ });

		const first = component.render(60).join("\n");
		expect(first).toContain("prompt 0");
		expect(first).not.toContain("prompt 12");
		expect(first).toContain("showing 1–12 of 30");

		component.handleInput("\u001b[B"); // down: cursor moves, window stays
		expect(renders).toBe(1);
		expect(component.render(60).join("\n")).toContain("showing 1–12 of 30");

		component.handleInput("\u001b[6~"); // page down: window shifts
		expect(component.render(60).join("\n")).toContain("showing 3–14 of 30");

		component.handleInput("\u001b[F"); // end
		expect(component.render(60).join("\n")).toContain("showing 19–30 of 30");
	});

	test("Enter selects the focused point", () => {
		const chosen: RewindPoint[] = [];
		const component = rewindList({ onClose: (point?: RewindPoint) => point && chosen.push(point) });

		component.handleInput("\u001b[B");
		component.handleInput("\r");

		expect(chosen).toEqual([POINTS[1]]);
	});

	test("the wheel moves the selection and ignores other mouse events", () => {
		const component = rewindList();
		component.render(60);

		expect(component.handleMouse({ type: "wheel", wheelDelta: 1 } as any)).toEqual({ handled: true });
		const selected = component.render(60).find((line) => line.startsWith("❯"));
		expect(selected).toContain("add tests");
		expect(component.handleMouse({ type: "click", button: "left" } as any)).toBeUndefined();
	});
});

const PATH_CHANGES = [
	{ path: "a.txt", change: "modified" as const },
	{ path: "src/b.txt", change: "added" as const },
];

describe("/rewind path step", () => {
	function pathCtx(mode: string) {
		const fake = setupRewind([WRITE_TOOL]);
		return { fake, ctx: makeCtx(fake, { cwd: "/tmp", hasUI: true, mode }) };
	}

	test("non-TUI modes restore everything without mounting a screen", async () => {
		const { fake, ctx } = pathCtx("rpc");
		let mounted = 0;
		ctx.ui.custom = async () => {
			mounted += 1;
			return undefined;
		};

		expect(await choosePaths(fake.pi, ctx, PATH_CHANGES)).toEqual({ kind: "all" });
		expect(mounted).toBe(0);
	});

	test("an empty diff has nothing to choose", async () => {
		const { fake, ctx } = pathCtx("tui");

		expect(await choosePaths(fake.pi, ctx, [])).toEqual({ kind: "all" });
	});

	test("offers the whole diff first and cancels when the dialog is dismissed", async () => {
		const { fake, ctx } = pathCtx("tui");
		const titles: string[] = [];
		ctx.ui.select = async (title: string) => {
			titles.push(title);
			return undefined;
		};

		expect(await choosePaths(fake.pi, ctx, PATH_CHANGES)).toEqual({ kind: "cancel" });
		expect(titles[0]).toBe("Restore what?");
	});

	test("takes the whole diff from the first answer", async () => {
		const { fake, ctx } = pathCtx("tui");
		ctx.ui.select = async () => "Everything (2 files)";

		expect(await choosePaths(fake.pi, ctx, PATH_CHANGES)).toEqual({ kind: "all" });
	});

	test("mounts the checklist and returns the paths it reports", async () => {
		const { fake, ctx } = pathCtx("tui");
		ctx.ui.select = async () => "Choose paths…";
		ctx.ui.custom = async () => ["src/b.txt"];

		expect(await choosePaths(fake.pi, ctx, PATH_CHANGES)).toEqual({ kind: "some", paths: ["src/b.txt"] });
	});

	test("a cancelled checklist cancels the rewind", async () => {
		const { fake, ctx } = pathCtx("tui");
		ctx.ui.select = async () => "Choose paths…";
		ctx.ui.custom = async () => undefined;

		expect(await choosePaths(fake.pi, ctx, PATH_CHANGES)).toEqual({ kind: "cancel" });
	});
});

const setup = () => setupRewind([WRITE_TOOL]);

describe.skipIf(!runSlowSuites)("/rewind command", () => {
	test("conversation-only moves the session and leaves files alone", async () => {
		const repo = await makeRepo("pi-rw-cmd-talk-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, hasUI: true, mode: "rpc", branch: branchWithUser("e1"), sessionId: "s1" });
		await primeRewind(fake, ctx);
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
		await primeRewind(fake, ctx);
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
		await primeRewind(fake, ctx);
		ctx.ui.select = answer("Code and conversation");

		await fake.commands.get("rewind").handler("", ctx);

		expect(ctx.navigations).toEqual(["e1"]);
		expect(existsSync(join(repo, "after.txt"))).toBe(false);
	});

	test("works outside a git repository for conversation only", async () => {
		const dir = tempDir("pi-rw-cmd-nogit-");
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

		expect(ctx.notices.at(-1)?.message).toContain("1 prompt (newest first)");
	});

	test("reports an empty timeline", async () => {
		const repo = await makeRepo("pi-rw-cmd-empty-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, hasUI: true, mode: "rpc", branch: [], sessionId: "s1" });

		await fake.commands.get("rewind").handler("", ctx);

		expect(ctx.notices.at(-1)?.message).toContain("No prompts to rewind to yet.");
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
		await primeRewind(fake, ctx);
		ctx.ui.select = answer("Conversation only");

		await fake.commands.get("rewind").handler("", ctx);

		// navigateTree is a no-op at the leaf, so the prompt is set manually.
		expect(ctx.navigations).toEqual(["e1"]);
		expect(ctx.editorSets).toEqual(["do the task"]);
	});

	test("refuses a rewind while a merge is in progress", async () => {
		const repo = await makeRepo("pi-rw-cmd-merge-");
		cleanups.push(repo);
		const fake = setup();
		const ctx = makeCtx(fake, { cwd: repo, hasUI: true, mode: "rpc", branch: branchWithUser("e1"), sessionId: "s1" });
		await primeRewind(fake, ctx);
		ctx.ui.select = answer("Code only");
		const mergeHead = (await runGit(["rev-parse", "--git-path", "MERGE_HEAD"], { cwd: repo })).stdout.trim();
		writeFileSync(join(repo, mergeHead), "0000000000000000000000000000000000000000\n");

		await fake.commands.get("rewind").handler("", ctx);

		expect(ctx.notices.at(-1)?.message).toContain("merge");
		expect(ctx.navigations).toEqual([]);
		expect(existsSync(join(repo, "after.txt"))).toBe(true);
	});
});

describe.skipIf(!runSlowSuites)("git plumbing", () => {
	test("nameStatus and diffStat describe one tree diff literally", async () => {
		const repo = await makeRepo("pi-rw-git-diff-");
		cleanups.push(repo);
		const before = (await runGit(["rev-parse", "HEAD^{tree}"], { cwd: repo })).stdout.trim();
		writeFileSync(join(repo, "README.md"), "changed\n");
		writeFileSync(join(repo, "new.txt"), "new\n");
		const current = await treeFromWorkingTree(runGit, repo, indexFileFor(repo, "diff"), true);

		expect(await nameStatus(runGit, repo, before, current, ["new.txt"])).toEqual([
			{ path: "new.txt", change: "added" },
		]);
		expect(await diffStat(runGit, repo, before, current, ["new.txt"])).not.toContain("README.md");
	});

	test("nameStatus pairs a rename even when the user disabled diff.renames", async () => {
		const repo = await makeRepo("pi-rw-git-rename-");
		cleanups.push(repo);
		const before = (await runGit(["rev-parse", "HEAD^{tree}"], { cwd: repo })).stdout.trim();
		await runGit(["config", "diff.renames", "false"], { cwd: repo });
		await runGit(["mv", "README.md", "renamed.md"], { cwd: repo });
		const current = await treeFromWorkingTree(runGit, repo, indexFileFor(repo, "rename"), true);

		// `-M` is explicit, so a config that turns rename detection off cannot
		// change rewind's one-row pairing.
		expect(await nameStatus(runGit, repo, before, current)).toEqual([
			{ path: "renamed.md", change: "renamed", from: "README.md" },
		]);
	});

	test("restorePaths rewrites only the named paths and leaves the real index alone", async () => {
		const repo = await makeRepo("pi-rw-git-restore-");
		cleanups.push(repo);
		const commit = (await runGit(["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();
		writeFileSync(join(repo, "README.md"), "changed\n");
		writeFileSync(join(repo, "other.txt"), "changed too\n");

		await restorePaths(runGit, repo, commit, indexFileFor(repo, "partial"), ["README.md"]);

		expect(readFileSync(join(repo, "README.md"), "utf-8")).not.toBe("changed\n");
		// Not selected, so untouched.
		expect(readFileSync(join(repo, "other.txt"), "utf-8")).toBe("changed too\n");
		expect((await runGit(["diff", "--cached", "--name-only"], { cwd: repo })).stdout.trim()).toBe("");
	});

	test("busyGitState names an in-progress merge", async () => {
		const repo = await makeRepo("pi-rw-git-merge-");
		cleanups.push(repo);
		expect(await busyGitState(runGit, repo)).toBeUndefined();
		const mergeHead = (await runGit(["rev-parse", "--git-path", "MERGE_HEAD"], { cwd: repo })).stdout.trim();
		writeFileSync(join(repo, mergeHead), "x\n");

		expect(await busyGitState(runGit, repo)).toBe("merge");

		rmSync(join(repo, mergeHead), { force: true });
	});

	test("busyGitState reads every marker from the one batched path query", async () => {
		const repo = await makeRepo("pi-rw-git-cherry-");
		cleanups.push(repo);
		const marker = (await runGit(["rev-parse", "--git-path", "CHERRY_PICK_HEAD"], { cwd: repo })).stdout.trim();
		writeFileSync(join(repo, marker), "x\n");

		// The batched `rev-parse` maps one output line per marker by position; a
		// misalignment would name a marker whose file does not exist.
		expect(await busyGitState(runGit, repo)).toBe("cherry-pick");

		rmSync(join(repo, marker), { force: true });
	});
});

describe.skipIf(!runSlowSuites)("restore", () => {
	test("plan and apply restore modified and deleted files and remove added ones", async () => {
		const repo = await makeRepo("pi-rw-restore-full-");
		cleanups.push(repo);
		writeFileSync(join(repo, "keep.txt"), "keep\n");
		writeFileSync(join(repo, ".gitignore"), "ignored.txt\n");
		await runGit(["add", "."], { cwd: repo });
		await runGit(["commit", "-qm", "keep"], { cwd: repo });
		const snapshot = await createSnapshot({ runGit, now: () => 1000, idFactory: () => "r1" }, snapshotInput(repo));

		writeFileSync(join(repo, "README.md"), "changed\n");
		rmSync(join(repo, "keep.txt"));
		writeFileSync(join(repo, "new.txt"), "new\n");
		writeFileSync(join(repo, "ignored.txt"), "secret\n");
		const headBefore = (await runGit(["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();

		const plan = await planRestore({ runGit }, { root: repo, indexFile: indexFileFor(repo), target: snapshot });
		expect(plan.ok).toBe(true);
		if (!plan.ok) return;
		expect(plan.plan.changed).toBe(2);
		expect(plan.plan.removed).toBe(1);
		expect(plan.plan.diff).toContain("README.md");
		expect(plan.plan.diff).not.toContain("ignored.txt");
		expect(plan.plan.currentTree).toMatch(/^[0-9a-f]{40,64}$/);

		const summary = await applyRestore({ runGit }, { root: repo, indexFile: indexFileFor(repo), target: snapshot });
		expect(summary.changed).toBe(2);
		expect(summary.removed).toBe(1);

		expect(readFileSync(join(repo, "README.md"), "utf-8")).toBe("hello\n");
		expect(readFileSync(join(repo, "keep.txt"), "utf-8")).toBe("keep\n");
		expect(existsSync(join(repo, "new.txt"))).toBe(false);
		// Ignored files are never part of a snapshot, so a rewind leaves them alone.
		expect(existsSync(join(repo, "ignored.txt"))).toBe(true);
		// HEAD never moves.
		expect((await runGit(["rev-parse", "HEAD"], { cwd: repo })).stdout.trim()).toBe(headBefore);
		expect((await runGit(["log", "-1", "--format=%s"], { cwd: repo })).stdout.trim()).toBe("keep");
	});

	test("leaves untracked files alone and reverts tracked ones when the snapshot excluded them", async () => {
		const repo = await makeRepo("pi-rw-restore-excl-");
		cleanups.push(repo);
		const snapshot = await createSnapshot(
			{ runGit, now: () => 1000, idFactory: () => "e1" },
			snapshotInput(repo, { includeUntracked: false }),
		);
		writeFileSync(join(repo, "README.md"), "tracked edit\n");
		writeFileSync(join(repo, "later.txt"), "later\n");

		const plan = await planRestore({ runGit }, { root: repo, indexFile: indexFileFor(repo), target: snapshot });
		expect(plan.ok && plan.plan.removed).toBe(0);
		expect(plan.ok && plan.plan.changed).toBe(1);

		await applyRestore({ runGit }, { root: repo, indexFile: indexFileFor(repo), target: snapshot });

		expect(existsSync(join(repo, "later.txt"))).toBe(true);
		expect(readFileSync(join(repo, "README.md"), "utf-8")).not.toBe("tracked edit\n");
	});

	test("refuses while a merge is in progress", async () => {
		const repo = await makeRepo("pi-rw-restore-merge-");
		cleanups.push(repo);
		const snapshot = await createSnapshot({ runGit, now: () => 2000, idFactory: () => "r2" }, snapshotInput(repo));
		const mergeHead = (await runGit(["rev-parse", "--git-path", "MERGE_HEAD"], { cwd: repo })).stdout.trim();
		writeFileSync(join(repo, mergeHead), "0000000000000000000000000000000000000000\n");

		const plan = await planRestore({ runGit }, { root: repo, indexFile: indexFileFor(repo), target: snapshot });

		expect(plan.ok).toBe(false);
		if (!plan.ok) expect(plan.reason).toContain("merge");
	});

	test("a partial restore rewrites only the selected paths and reports the whole diff size", async () => {
		const repo = await makeRepo("pi-rw-restore-partial-");
		cleanups.push(repo);
		mkdirSync(join(repo, "src"), { recursive: true });
		writeFileSync(join(repo, "a.txt"), "a1\n");
		writeFileSync(join(repo, "src", "b.txt"), "b1\n");
		writeFileSync(join(repo, "src", "gone.txt"), "gone1\n");
		await runGit(["add", "."], { cwd: repo });
		await runGit(["commit", "-qm", "base"], { cwd: repo });
		const snapshot = await createSnapshot({ runGit, now: () => 1000, idFactory: () => "p1" }, snapshotInput(repo));

		writeFileSync(join(repo, "a.txt"), "a2\n");
		writeFileSync(join(repo, "src", "b.txt"), "b2\n");
		rmSync(join(repo, "src", "gone.txt"));
		writeFileSync(join(repo, "src", "added.txt"), "new\n");

		const all = await planRestore({ runGit }, { root: repo, indexFile: indexFileFor(repo), target: snapshot });
		expect(all.ok && all.plan.changed).toBe(3);
		expect(all.ok && all.plan.removed).toBe(1);

		const subset = ["a.txt", "src/added.txt"];
		const plan = await planRestore(
			{ runGit },
			{ root: repo, indexFile: indexFileFor(repo), target: snapshot, paths: subset },
		);
		expect(plan.ok).toBe(true);
		if (!plan.ok) return;
		expect(plan.plan.paths.map((entry) => entry.path).sort()).toEqual(["a.txt", "src/added.txt"]);
		expect(plan.plan.changed).toBe(1);
		expect(plan.plan.removed).toBe(1);
		expect(plan.plan.diff).toContain("a.txt");
		expect(plan.plan.diff).not.toContain("b.txt");

		const summary = await applyRestore(
			{ runGit },
			{ root: repo, indexFile: indexFileFor(repo), target: snapshot, paths: subset },
		);
		expect(summary.changed).toBe(1);
		expect(summary.removed).toBe(1);
		// The subset says how much of the whole diff it covers.
		expect(summary.of).toBe(4);

		expect(readFileSync(join(repo, "a.txt"), "utf-8")).toBe("a1\n");
		expect(existsSync(join(repo, "src", "added.txt"))).toBe(false);
		// Unselected paths keep the post-snapshot state, deletion included.
		expect(readFileSync(join(repo, "src", "b.txt"), "utf-8")).toBe("b2\n");
		expect(existsSync(join(repo, "src", "gone.txt"))).toBe(false);
		expect((await runGit(["diff", "--cached", "--name-only"], { cwd: repo })).stdout.trim()).toBe("");
	});

	test("a partial restore of a deletion brings the file back", async () => {
		const repo = await makeRepo("pi-rw-restore-undelete-");
		cleanups.push(repo);
		writeFileSync(join(repo, "keep.txt"), "keep1\n");
		await runGit(["add", "."], { cwd: repo });
		await runGit(["commit", "-qm", "base"], { cwd: repo });
		const snapshot = await createSnapshot({ runGit, now: () => 1000, idFactory: () => "u1" }, snapshotInput(repo));

		rmSync(join(repo, "keep.txt"));
		await applyRestore(
			{ runGit },
			{ root: repo, indexFile: indexFileFor(repo), target: snapshot, paths: ["keep.txt"] },
		);

		expect(readFileSync(join(repo, "keep.txt"), "utf-8")).toBe("keep1\n");
	});

	test("a partial restore selected by either side of a rename restores both sides", async () => {
		const repo = await makeRepo("pi-rw-restore-rename-");
		cleanups.push(repo);
		writeFileSync(join(repo, "before.txt"), "original\n");
		await runGit(["add", "."], { cwd: repo });
		await runGit(["commit", "-qm", "base"], { cwd: repo });
		const snapshot = await createSnapshot({ runGit, now: () => 1000, idFactory: () => "rn1" }, snapshotInput(repo));

		await runGit(["mv", "before.txt", "after.txt"], { cwd: repo });
		const indexBefore = (await runGit(["diff", "--cached", "--name-status"], { cwd: repo })).stdout;

		const plan = await planRestore({ runGit }, { root: repo, indexFile: indexFileFor(repo), target: snapshot });
		expect(plan.ok).toBe(true);
		if (!plan.ok) return;
		expect(plan.plan.paths).toEqual([{ path: "after.txt", change: "renamed", from: "before.txt" }]);
		expect(plan.plan.changed).toBe(1);
		expect(plan.plan.removed).toBe(0);
		expect(plan.plan.diff).toContain("before.txt");
		expect(plan.plan.diff).toContain("after.txt");

		// Selecting only the destination is the row's key; the restore must still
		// recreate the source, or the rename is left half-applied.
		const summary = await applyRestore(
			{ runGit },
			{ root: repo, indexFile: indexFileFor(repo), target: snapshot, paths: ["after.txt"] },
		);
		expect(summary.changed).toBe(1);
		expect(summary.removed).toBe(0);
		expect(summary.of).toBe(1);
		expect(readFileSync(join(repo, "before.txt"), "utf-8")).toBe("original\n");
		expect(existsSync(join(repo, "after.txt"))).toBe(false);
		expect((await runGit(["diff", "--cached", "--name-status"], { cwd: repo })).stdout).toBe(indexBefore);

		// Selecting the source side of the pair is the same move.
		renameSync(join(repo, "before.txt"), join(repo, "after.txt"));
		await applyRestore(
			{ runGit },
			{ root: repo, indexFile: indexFileFor(repo), target: snapshot, paths: ["before.txt"] },
		);
		expect(readFileSync(join(repo, "before.txt"), "utf-8")).toBe("original\n");
		expect(existsSync(join(repo, "after.txt"))).toBe(false);
	});

	test("a case-only rename restores the file without deleting it", async () => {
		const repo = await makeRepo("pi-rw-restore-case-");
		cleanups.push(repo);
		writeFileSync(join(repo, "foo.txt"), "original\n");
		await runGit(["add", "."], { cwd: repo });
		await runGit(["commit", "-qm", "base"], { cwd: repo });
		const snapshot = await createSnapshot({ runGit, now: () => 1000, idFactory: () => "c1" }, snapshotInput(repo));
		await runGit(["mv", "foo.txt", "Foo.txt"], { cwd: repo });

		await applyRestore({ runGit }, { root: repo, indexFile: indexFileFor(repo), target: snapshot, paths: ["Foo.txt"] });

		// On a case-insensitive filesystem both names resolve to one file, so the
		// checkout renames it and the destination delete must be skipped.
		expect(readFileSync(join(repo, "foo.txt"), "utf-8")).toBe("original\n");
		expect(readdirSync(repo).filter((name) => name.toLowerCase() === "foo.txt")).toEqual(["foo.txt"]);
	});

	test("a path with a glob character restores literally", async () => {
		const repo = await makeRepo("pi-rw-restore-glob-");
		cleanups.push(repo);
		writeFileSync(join(repo, "weird[1].txt"), "one\n");
		await runGit(["add", "."], { cwd: repo });
		await runGit(["commit", "-qm", "base"], { cwd: repo });
		const snapshot = await createSnapshot({ runGit, now: () => 1000, idFactory: () => "g1" }, snapshotInput(repo));

		writeFileSync(join(repo, "weird[1].txt"), "two\n");
		await applyRestore(
			{ runGit },
			{ root: repo, indexFile: indexFileFor(repo), target: snapshot, paths: ["weird[1].txt"] },
		);

		expect(readFileSync(join(repo, "weird[1].txt"), "utf-8")).toBe("one\n");
	});

	test("restores a nested file without touching its siblings", async () => {
		const repo = await makeRepo("pi-rw-restore-nested-");
		cleanups.push(repo);
		mkdirSync(join(repo, "sub"), { recursive: true });
		writeFileSync(join(repo, "sub", "file.txt"), "x\n");
		const snapshot = await createSnapshot({ runGit, now: () => 1000, idFactory: () => "x1" }, snapshotInput(repo));

		writeFileSync(join(repo, "sub", "file.txt"), "changed\n");
		await applyRestore({ runGit }, { root: repo, indexFile: indexFileFor(repo), target: snapshot });

		expect(readFileSync(join(repo, "sub", "file.txt"), "utf-8")).toBe("x\n");
	});
});

describe("runtime guards", () => {
	function bareRuntime(): RewindRuntime {
		const fake = createFakePi();
		return createRuntime(fake.pi);
	}

	test("refuses a snapshot taken from another root before touching the tree", async () => {
		const fake = createFakePi();
		const runtime = createRuntime(fake.pi);
		const ctx = makeCtx(fake, { cwd: "/repo" });
		const foreign = makeSnapshot({ root: "/elsewhere" });

		const plan = await runtime.plan("/repo", foreign);
		expect(plan.ok).toBe(false);
		if (!plan.ok) expect(plan.reason).toContain("taken from /elsewhere");

		await expect(runtime.restore(ctx, "/repo", foreign, DEFAULT_CONFIG)).rejects.toThrow(/taken from/);
	});

	test("caches the config per root until invalidate drops it", async () => {
		await withAgentDir(() => {
			const repo = tempDir("rewind-cache-");
			mkdirSync(join(repo, ".pi"), { recursive: true });
			writeFileSync(join(repo, ".pi", "bytefly.json"), JSON.stringify({ rewind: { max: 5 } }));
			const runtime = bareRuntime();

			expect(runtime.configFor(repo).max).toBe(5);
			writeFileSync(join(repo, ".pi", "bytefly.json"), JSON.stringify({ rewind: { max: 9 } }));
			expect(runtime.configFor(repo).max).toBe(5);

			runtime.invalidate();
			expect(runtime.configFor(repo).max).toBe(9);
		}, "rewind-cache-global-");
	});
});

describe.skipIf(!runSlowSuites)("runtime operations", () => {
	function liveRuntime() {
		useEnv({ PI_WORKTREE_ROOT: undefined });
		const fake = createFakePi({ exec: (command, args, options) => execP(command, args, options) });
		return { fake, runtime: createRuntime(fake.pi) };
	}

	test("snapshot honours autoPrune and the configured namespace", async () => {
		const repo = await makeRepo("pi-rw-runtime-prune-");
		cleanups.push(repo);
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(repo, ".pi", "bytefly.json"), JSON.stringify({ rewind: { max: 1 } }));
		const { fake, runtime } = liveRuntime();
		const ctx = makeCtx(fake, { cwd: repo, branch: branchWithUser("e1"), sessionId: "s1" });

		await runtime.snapshot(ctx, { reason: "auto", prompt: "one" });
		writeFileSync(join(repo, "later.txt"), "later\n");
		await runtime.snapshot(ctx, { reason: "auto", prompt: "two" });

		expect(await rewindRefs(repo)).toHaveLength(1);
		expect((await rewindMetadata(repo))[0]?.prompt).toBe("two");
		runtime.releaseIndexes();
		expect(existsSync(join(repo, ".git", "pi", `rewind-index-${process.pid}`))).toBe(false);
	});

	test("headTree is undefined without a commit and list is empty without snapshots", async () => {
		const repo = await makeRepo("pi-rw-runtime-empty-");
		cleanups.push(repo);
		await runGit(["update-ref", "-d", "HEAD"], { cwd: repo });
		const { runtime } = liveRuntime();

		expect(await runtime.headTree(repo)).toBeUndefined();
		expect(await runtime.list(repo)).toEqual([]);
	});
});
