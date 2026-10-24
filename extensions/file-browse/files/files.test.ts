/**
 * The files capability: classification and capped reads, the sidebar tree and
 * quick-open index, path containment, diff parsing, the read-only git providers,
 * fuzzy ranking, and the icon table.
 *
 * Real filesystem work runs in the fixture's temp root; git is driven through the
 * injected `pi.exec` seam. Everything else is a pure view model.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { makeClock } from "../../../test/helpers/clock.ts";
import { createFakePi, type FakePiOptions } from "../../../test/helpers/fakes.ts";
import { makeFixture, type Fixture } from "../../../test/helpers/fixtures/file-browse.ts";
import {
	changeDirs,
	diffArgs,
	inMode,
	isDiffMode,
	parseStatusZ,
	parseUnifiedDiff,
	statusLetter,
	type ChangedFile,
	type DiffLine,
} from "../text/diff.ts";
import {
	buildFileIndex,
	buildTree,
	classifyByName,
	contentTypeFor,
	createFileIndex,
	directoryView,
	isImageName,
	isMarkdownName,
	isProbablyText,
	listDirectory,
	readFileView,
	type DirectoryFs,
	type TreeNode,
} from "./files.ts";
import { createGitDiff, createGitStatus } from "../git/git.ts";
import { listingRevision } from "../live/rev.ts";
import { FOLDER_ICON, iconHref, languageOf, SPRITE } from "../view/icons.ts";
import { fuzzyMatch, fuzzySearch, type FuzzyResult } from "../text/fuzzy.ts";
import { HttpError, encodePath, relativePath, resolveDecodedPath, resolveRequestPath } from "./paths.ts";

let fixture: Fixture | undefined;

afterEach(() => {
	fixture?.remove();
	fixture = undefined;
});

/** A fresh fixture; the returned root is its real path. */
function root(): string {
	fixture = makeFixture();
	return fixture.root;
}

describe("file classification", () => {
	test("recognizes images, text extensions, extensionless text names, and binary", () => {
		expect(classifyByName("a.png")).toBe("image");
		expect(classifyByName("a.ts")).toBe("text");
		expect(classifyByName("README.md")).toBe("text");
		expect(classifyByName(".gitignore")).toBe("text");
		expect(classifyByName("LICENSE")).toBe("text");
		expect(classifyByName("Makefile")).toBe("text");
		expect(classifyByName("logo.bin")).toBe("binary");
		expect(classifyByName("mystery")).toBe("binary");
	});

	test("matches image and Markdown extensions case-insensitively", () => {
		expect(isImageName("a.PNG")).toBe(true);
		expect(isImageName("a.svg")).toBe(true);
		expect(isImageName("a.txt")).toBe(false);
		expect(isMarkdownName("README.md")).toBe(true);
		expect(isMarkdownName("notes.MARKDOWN")).toBe(true);
		expect(isMarkdownName("a.txt")).toBe(false);
	});

	test("accepts UTF-8 text and rejects NUL and control-heavy bytes", () => {
		expect(isProbablyText(Buffer.from("hello\nworld"))).toBe(true);
		expect(isProbablyText(Buffer.alloc(0))).toBe(true);
		expect(isProbablyText(Buffer.from([0, 1, 2, 3]))).toBe(false);
		expect(isProbablyText(Buffer.from([1, 2, 3, 4]))).toBe(false);
	});

	test("maps image MIME types and defaults everything else to octet-stream", () => {
		expect(contentTypeFor("a.png")).toBe("image/png");
		expect(contentTypeFor("a.svg")).toBe("image/svg+xml");
		expect(contentTypeFor("a.zip")).toBe("application/octet-stream");
	});
});

describe("path containment", () => {
	test("resolves the root, files, and folders", async () => {
		const base = root();
		expect(await resolveRequestPath(base, "/")).toBe(base);
		expect(await resolveRequestPath(base, "/a.txt")).toBe(join(base, "a.txt"));
		expect(await resolveRequestPath(base, "sub")).toBe(join(base, "sub"));
	});

	test("rejects traversal, encoded or not", async () => {
		const base = root();
		await expect(resolveRequestPath(base, "../outside/secret.txt")).rejects.toBeInstanceOf(HttpError);
		await expect(resolveRequestPath(base, "%2e%2e/outside/secret.txt")).rejects.toBeInstanceOf(HttpError);
	});

	test("rejects NUL bytes, malformed escapes, and Windows-style absolute paths", async () => {
		const base = root();
		await expect(resolveRequestPath(base, "a.txt%00")).rejects.toMatchObject({ status: 400 });
		await expect(resolveRequestPath(base, "bad%zz")).rejects.toMatchObject({ status: 400 });
		await expect(resolveRequestPath(base, "C:/Windows")).rejects.toMatchObject({ status: 403 });
	});

	test("blocks a symlink that points outside the root and allows one that stays inside", async () => {
		const base = root();
		if (!fixture?.hasSymlinks) return;
		await expect(resolveRequestPath(base, "escape.txt")).rejects.toMatchObject({ status: 403 });
		expect(await resolveRequestPath(base, "link.txt")).toBe(join(base, "a.txt"));
	});

	test("allows a missing leaf so the caller can answer 404", async () => {
		const base = root();
		expect(await resolveRequestPath(base, "missing.txt")).toBe(join(base, "missing.txt"));
	});

	test("does not decode a second time in resolveDecodedPath", async () => {
		const base = root();
		expect(await resolveDecodedPath(base, "a.txt")).toBe(join(base, "a.txt"));
		await expect(resolveDecodedPath(base, "../x")).rejects.toMatchObject({ status: 403 });
	});

	test("encodes each segment and keeps separators", () => {
		expect(encodePath("sub/a b#c.ts")).toBe("sub/a%20b%23c.ts");
		expect(encodePath("")).toBe("");
		expect(encodePath("a/b c/d&e.txt")).toBe("a/b%20c/d%26e.txt");
	});

	test("reports a root-relative path with posix separators", () => {
		expect(relativePath("/a/b", "/a/b")).toBe("");
		expect(relativePath("/a/b", "/a/b/c/d")).toBe("c/d");
	});
});

describe("directory listings", () => {
	test("sorts directories first, then names case-insensitively", async () => {
		const base = root();
		const listing = await listDirectory(base, "", 100);
		const names = listing.entries.map((entry) => entry.name);
		expect(names[0]).toBe("sub");
		const fileNames = names.slice(1);
		expect(fileNames).toEqual([...fileNames].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
	});

	test("marks symlinks and images", async () => {
		const base = root();
		const listing = await listDirectory(base, "", 100);
		expect(listing.entries.find((entry) => entry.name === "link.txt")?.isSymlink).toBe(true);
		expect(listing.entries.find((entry) => entry.name === "image.png")?.isImage).toBe(true);
	});

	test("caps entries and reports the full total", async () => {
		const base = root();
		const listing = await listDirectory(base, "", 2);
		expect(listing.entries).toHaveLength(2);
		expect(listing.truncated).toBe(true);
		expect(listing.total).toBeGreaterThan(2);
	});

	test("sorts a symlink to a directory with the directories", async () => {
		const base = root();
		mkdirSync(join(base, "zdir"));
		try {
			symlinkSync(join(base, "zdir"), join(base, "alink"));
		} catch {
			return;
		}
		const listing = await listDirectory(base, "", 100);
		const link = listing.entries.find((entry) => entry.name === "alink");
		expect(link?.isDir).toBe(true);
		expect(link?.kind).toBe("directory");
		const firstFile = listing.entries.findIndex((entry) => !entry.isDir);
		const lastDir = listing.entries.reduce((last, entry, index) => (entry.isDir ? index : last), -1);
		expect(lastDir).toBeLessThan(firstFile);
	});

	test("stats only the rows it keeps, through a bounded pool", async () => {
		const names = Array.from({ length: 100 }, (_, index) => `file-${String(index).padStart(3, "0")}`);
		const reads: string[] = [];
		let inFlight = 0;
		let peak = 0;
		const stats = { size: 7, mtimeMs: 11, isDirectory: () => false };
		const fs: DirectoryFs = {
			readdir: async () => names.map((name) => ({ name, isDirectory: () => false, isSymbolicLink: () => false })),
			lstat: async () => stats,
			stat: async (path) => {
				reads.push(basename(path));
				inFlight++;
				peak = Math.max(peak, inFlight);
				await Promise.resolve();
				inFlight--;
				return stats;
			},
		};

		const listing = await listDirectory("/synthetic", "", 10, fs);

		expect(listing.total).toBe(100);
		expect(listing.truncated).toBe(true);
		expect(listing.entries.map((entry) => entry.name)).toEqual(names.slice(0, 10));
		expect(listing.entries.every((entry) => entry.size === 7 && entry.mtimeMs === 11)).toBe(true);
		expect(reads).toEqual(names.slice(0, 10));
		expect(peak).toBe(10);
	});

	test("rejects a directory it cannot read", async () => {
		const fs: DirectoryFs = {
			readdir: async () => {
				throw new Error("EACCES");
			},
			lstat: async () => ({ size: 0, mtimeMs: 0, isDirectory: () => false }),
			stat: async () => ({ size: 0, mtimeMs: 0, isDirectory: () => false }),
		};
		await expect(listDirectory("/synthetic", "", 10, fs)).rejects.toMatchObject({
			status: 404,
			message: "That folder could not be read.",
		});
	});
});

describe("listing revisions", () => {
	test("is independent of the order the names arrived in", () => {
		expect(listingRevision(["b.txt", "a.txt", "sub"])).toBe(listingRevision(["sub", "b.txt", "a.txt"]));
	});

	test("moves when a name appears or goes, and stays for the same names", () => {
		const before = listingRevision(["a.txt", "sub"]);
		expect(listingRevision(["a.txt", "sub"])).toBe(before);
		expect(listingRevision(["a.txt", "sub", "new.ts"])).not.toBe(before);
		expect(listingRevision(["a.txt"])).not.toBe(before);
	});

	test("does not run adjacent names together into one digest", () => {
		// The NUL separator is what a filename cannot contain, so a split cannot
		// collide with a different split of the same text.
		expect(listingRevision(["ab", "c"])).not.toBe(listingRevision(["a", "bc"]));
	});
});

describe("file views", () => {
	test("reads text into lines", async () => {
		const base = root();
		const view = await readFileView(base, "a.txt", 1_000_000, 100);
		expect(view.kind).toBe("text");
		if (view.kind !== "text") return;
		expect(view.lines).toEqual(["hello", "world", ""]);
		expect(view.truncated).toBe(false);
	});

	test("truncates long text and reports the full line count", async () => {
		const base = root();
		const view = await readFileView(base, "big.txt", 1_000_000, 4);
		expect(view.kind).toBe("text");
		if (view.kind !== "text") return;
		expect(view.truncated).toBe(true);
		expect(view.totalLines).toBeGreaterThan(4);
	});

	test("classifies images, binary, and over-size files", async () => {
		const base = root();
		expect((await readFileView(base, "image.png", 1_000_000, 100)).kind).toBe("image");
		expect((await readFileView(base, "bin.dat", 1_000_000, 100)).kind).toBe("binary");
		expect((await readFileView(base, "big.txt", 10, 100)).kind).toBe("tooLarge");
	});

	test("renders Markdown only when the switch is on", async () => {
		const base = root();
		expect((await readFileView(base, "sub/b.md", 1_000_000, 100)).kind).toBe("markdown");
		expect((await readFileView(base, "sub/b.md", 1_000_000, 100, false)).kind).toBe("text");
	});

	test("reports a missing file and a folder as 404", async () => {
		const base = root();
		await expect(readFileView(base, "missing.txt", 1000, 10)).rejects.toMatchObject({ status: 404 });
		await expect(readFileView(base, "sub", 1000, 10)).rejects.toMatchObject({ status: 404 });
	});
});

describe("tree and quick-open index", () => {
	test("expands only the current path's ancestors", async () => {
		const base = root();
		const tree = await buildTree(base, "sub", 100);
		const sub = tree.children.find((node) => node.name === "sub");
		expect(sub?.children.map((node) => node.name)).toContain("b.md");
		const file = tree.children.find((node) => node.name === "a.txt");
		expect(file?.children).toHaveLength(0);
		expect(file?.isDir).toBe(false);
	});

	test("reveals a deep active file through every ancestor", async () => {
		const base = root();
		mkdirSync(join(base, "a", "b", "c", "d", "e"), { recursive: true });
		writeFileSync(join(base, "a", "b", "c", "d", "e", "f.txt"), "deep\n");
		let node: TreeNode = await buildTree(base, "a/b/c/d/e/f.txt", 100);
		for (const name of ["a", "b", "c", "d", "e"]) {
			const child = node.children.find((item) => item.name === name);
			if (!child) throw new Error(`missing ${name}`);
			expect(child.isDir).toBe(true);
			node = child;
		}
		expect(node.children.map((child) => child.name)).toContain("f.txt");
	});

	test("marks a dangling symlink as broken", async () => {
		const base = root();
		if (!fixture?.hasSymlinks) return;
		try {
			symlinkSync(join(base, "does-not-exist"), join(base, "dangling"));
		} catch {
			return;
		}
		const tree = await buildTree(base, "dangling", 100);
		expect(tree.children.find((child) => child.name === "dangling")?.broken).toBe(true);
	});

	test("directoryView returns the listing and tree for the current folder", async () => {
		const base = root();
		const view = await directoryView(base, "sub", 100);
		expect(view.listing.entries.map((entry) => entry.rel)).toContain("sub/b.md");
		expect(view.tree.children.map((node) => node.rel)).toContain("sub");
	});

	test("surfaces an unreadable directory as the listing's 404", async () => {
		await expect(directoryView("/missing-in-a-test", "", 100)).rejects.toMatchObject({
			status: 404,
			message: "That folder could not be read.",
		});
	});

	test("collects nested files as posix paths and excludes directories", async () => {
		const base = root();
		const index = await buildFileIndex(base, 1000);
		expect(index.files).toContain("a.txt");
		expect(index.files).toContain("sub/b.md");
		expect(index.files).not.toContain("sub");
		expect(index.truncated).toBe(false);
	});

	test("skips .git, node_modules, and symlinks", async () => {
		const base = root();
		mkdirSync(join(base, ".git"), { recursive: true });
		writeFileSync(join(base, ".git", "config"), "x\n");
		mkdirSync(join(base, "node_modules", "pkg"), { recursive: true });
		writeFileSync(join(base, "node_modules", "pkg", "index.js"), "x\n");
		const index = await buildFileIndex(base, 1000);
		expect(index.files.some((path) => path.startsWith(".git/"))).toBe(false);
		expect(index.files.some((path) => path.startsWith("node_modules/"))).toBe(false);
		expect(index.files).not.toContain("link.txt");
	});

	test("caps the index and reports truncation", async () => {
		const base = root();
		const index = await buildFileIndex(base, 2);
		expect(index.files).toHaveLength(2);
		expect(index.truncated).toBe(true);
	});

	test("reuses the index within the TTL and rebuilds after it", async () => {
		const base = root();
		let clock = 0;
		const index = createFileIndex(base, 1000, { ttlMs: 100, now: () => clock });
		await index();
		writeFileSync(join(base, "new.txt"), "x\n");
		expect((await index()).files).not.toContain("new.txt");
		clock = 200;
		expect((await index()).files).toContain("new.txt");
	});
});

function kinds(lines: DiffLine[]): string[] {
	return lines.map((line) => line.kind);
}

const changed = (partial: Partial<ChangedFile>): ChangedFile => ({
	rel: "x",
	index: " ",
	worktree: " ",
	untracked: false,
	...partial,
});

describe("diff parsing", () => {
	test("maps each mode to its revision arguments", () => {
		expect(diffArgs("head")).toEqual(["HEAD"]);
		expect(diffArgs("staged")).toEqual(["--cached"]);
		expect(diffArgs("worktree")).toEqual([]);
	});

	test("accepts the three modes and rejects anything else", () => {
		expect(isDiffMode("head")).toBe(true);
		expect(isDiffMode("staged")).toBe(true);
		expect(isDiffMode("worktree")).toBe(true);
		expect(isDiffMode("HEAD")).toBe(false);
		expect(isDiffMode("")).toBe(false);
		expect(isDiffMode(null)).toBe(false);
		expect(isDiffMode(undefined)).toBe(false);
	});

	test("numbers added, removed, and context lines", () => {
		const text = [
			"diff --git a/a.ts b/a.ts",
			"index 111..222 100644",
			"--- a/a.ts",
			"+++ b/a.ts",
			"@@ -10,3 +10,4 @@",
			" const a = 1;",
			"-const b = 2;",
			"+const b = 3;",
			"+const c = 4;",
			" ",
			"",
		].join("\n");
		const parsed = parseUnifiedDiff(text, 100);
		expect(parsed.binary).toBe(false);
		expect(parsed.truncated).toBe(false);
		expect(kinds(parsed.lines)).toEqual(["meta", "meta", "meta", "meta", "hunk", "ctx", "del", "add", "add", "ctx"]);
		const [, , , , hunk, ctx, del, add, add2, blank] = parsed.lines;
		expect(hunk.text).toBe("@@ -10,3 +10,4 @@");
		expect(ctx).toMatchObject({ text: "const a = 1;", oldNo: 10, newNo: 10 });
		expect(del).toMatchObject({ text: "const b = 2;", oldNo: 11 });
		expect(del.newNo).toBeUndefined();
		expect(add).toMatchObject({ text: "const b = 3;", newNo: 11 });
		expect(add.oldNo).toBeUndefined();
		expect(add2).toMatchObject({ text: "const c = 4;", newNo: 12 });
		expect(blank).toMatchObject({ kind: "ctx", text: "", oldNo: 12, newNo: 13 });
	});

	test("treats --- and +++ inside a hunk as a deletion and an addition", () => {
		const parsed = parseUnifiedDiff(["@@ -1,2 +1,2 @@", "--- keep", "+++ add", "-old", "+new"].join("\n"), 100);
		expect(parsed.lines.map((line) => [line.kind, line.text])).toEqual([
			["hunk", "@@ -1,2 +1,2 @@"],
			["del", "-- keep"],
			["add", "++ add"],
			["del", "old"],
			["add", "new"],
		]);
	});

	test("marks a no-newline note", () => {
		const parsed = parseUnifiedDiff(["@@ -1 +1 @@", "-a", "+b", "\\ No newline at end of file", ""].join("\n"), 100);
		expect(parsed.lines.at(-1)).toMatchObject({ kind: "note", text: "\\ No newline at end of file" });
	});

	test("starts a new file block after a hunk", () => {
		const parsed = parseUnifiedDiff(
			["@@ -1 +1 @@", "-a", "+b", "diff --git a/x b/x", "--- a/x", "+++ b/x", "@@ -5 +5 @@", "-c", "+d"].join("\n"),
			100,
		);
		expect(kinds(parsed.lines)).toEqual(["hunk", "del", "add", "meta", "meta", "meta", "hunk", "del", "add"]);
		expect(parsed.lines[6]).toMatchObject({ kind: "hunk", text: "@@ -5 +5 @@" });
		expect(parsed.lines[7]).toMatchObject({ oldNo: 5 });
	});

	test("detects both binary markers", () => {
		expect(parseUnifiedDiff("diff --git a/a.png b/a.png\nBinary files a/a.png and b/a.png differ\n", 100).binary).toBe(
			true,
		);
		expect(parseUnifiedDiff("diff --git a/a.png b/a.png\nGIT binary patch\n", 100).binary).toBe(true);
	});

	test("strips CRLF and drops the trailing newline", () => {
		const parsed = parseUnifiedDiff("@@ -1 +1 @@\r\n-a\r\n+b\r\n", 100);
		expect(parsed.lines.map((line) => line.text)).toEqual(["@@ -1 +1 @@", "a", "b"]);
	});

	test("truncates at maxLines and flags it", () => {
		const parsed = parseUnifiedDiff(["@@ -1,3 +1,3 @@", "-a", "+b", " c", " d"].join("\n"), 3);
		expect(parsed.truncated).toBe(true);
		expect(parsed.lines).toHaveLength(3);
	});

	test("returns nothing for empty input", () => {
		expect(parseUnifiedDiff("", 100)).toEqual({ lines: [], truncated: false, binary: false });
	});
});

describe("status parsing", () => {
	test("parses staged, unstaged, and untracked entries", () => {
		expect(parseStatusZ(" M a.txt\0M  b.txt\0MM c.txt\0?? new file.txt\0")).toEqual([
			{ rel: "a.txt", index: " ", worktree: "M", untracked: false },
			{ rel: "b.txt", index: "M", worktree: " ", untracked: false },
			{ rel: "c.txt", index: "M", worktree: "M", untracked: false },
			{ rel: "new file.txt", index: "?", worktree: "?", untracked: true },
		]);
	});

	test("reads a rename as destination then original", () => {
		expect(parseStatusZ("R  new.txt\0old.txt\0")).toEqual([
			{ rel: "new.txt", origRel: "old.txt", index: "R", worktree: " ", untracked: false },
		]);
	});

	test("parses deleted entries on either side", () => {
		expect(parseStatusZ(" D gone.txt\0D  staged-gone.txt\0")).toEqual([
			{ rel: "gone.txt", index: " ", worktree: "D", untracked: false },
			{ rel: "staged-gone.txt", index: "D", worktree: " ", untracked: false },
		]);
	});

	test("skips malformed or empty records", () => {
		expect(parseStatusZ("short\0\0 M ok.txt\0")).toEqual([
			{ rel: "ok.txt", index: " ", worktree: "M", untracked: false },
		]);
	});

	test("prefers the index letter and marks untracked", () => {
		expect(statusLetter(changed({ index: "M" }))).toBe("M");
		expect(statusLetter(changed({ worktree: "D" }))).toBe("D");
		expect(statusLetter(changed({ index: "M", worktree: "M" }))).toBe("M");
		expect(statusLetter(changed({ untracked: true, index: "?", worktree: "?" }))).toBe("?");
	});

	test("filters by the column each mode compares", () => {
		expect(inMode(changed({ worktree: "M" }), "worktree")).toBe(true);
		expect(inMode(changed({ index: "M" }), "worktree")).toBe(false);
		expect(inMode(changed({ index: "M" }), "staged")).toBe(true);
		expect(inMode(changed({ worktree: "M" }), "staged")).toBe(false);
		expect(inMode(changed({ untracked: true, index: "?", worktree: "?" }), "worktree")).toBe(true);
		expect(inMode(changed({ untracked: true, index: "?", worktree: "?" }), "staged")).toBe(false);
		expect(inMode(changed({ index: "M" }), "head")).toBe(true);
	});

	test("collects every ancestor directory without the file itself", () => {
		expect([...changeDirs([changed({ rel: "a.ts" })])]).toEqual([]);
		expect([...changeDirs([changed({ rel: "x/y/z.ts" })])].sort()).toEqual(["x", "x/y"]);
		expect(
			[...changeDirs([changed({ rel: "x/a.ts" }), changed({ rel: "x/y/b.ts" }), changed({ rel: "c.ts" })])].sort(),
		).toEqual(["x", "x/y"]);
		expect(changeDirs([]).size).toBe(0);
	});
});

interface Reply {
	stdout?: string;
	code?: number;
}

/** A `pi.exec` stub that answers git by longest matching argument prefix. */
function gitStub(replies: Array<[prefix: string, reply: Reply]>): {
	exec: NonNullable<FakePiOptions["exec"]>;
	calls: () => number;
} {
	let calls = 0;
	const exec = async (_command: string, args: string[]) => {
		calls++;
		const key = args.join(" ");
		for (const [prefix, reply] of replies) {
			if (key.startsWith(prefix)) return { stdout: reply.stdout ?? "", stderr: "", code: reply.code ?? 0 };
		}
		return { stdout: "", stderr: "unexpected", code: 1 };
	};
	return { exec, calls: () => calls };
}

const ROOT: [string, Reply] = ["rev-parse --show-toplevel", { stdout: "/repo\n" }];
const HEAD_OK: [string, Reply] = ["rev-parse --verify --quiet HEAD", { stdout: "abc1234def\n" }];

describe("git status provider", () => {
	test("maps the checked-out branch", async () => {
		const stub = gitStub([ROOT, ["rev-parse --abbrev-ref HEAD", { stdout: "main\n" }]]);
		const provider = createGitStatus(createFakePi({ exec: stub.exec }).pi, "/repo");
		expect(await provider()).toMatchObject({ branch: "main" });
	});

	test("reports a detached head when there is no branch", async () => {
		const stub = gitStub([
			ROOT,
			["rev-parse --abbrev-ref HEAD", { code: 1 }],
			["rev-parse --verify", { stdout: "abc1234def5678\n" }],
		]);
		const provider = createGitStatus(createFakePi({ exec: stub.exec }).pi, "/repo");
		const status = await provider();
		expect(status?.branch).toBeUndefined();
		expect(status).toMatchObject({ head: "abc1234" });
	});

	test("returns undefined outside a repository, on failure, and when exec throws", async () => {
		const outside = gitStub([["rev-parse --show-toplevel", { code: 128 }]]);
		expect(await createGitStatus(createFakePi({ exec: outside.exec }).pi, "/repo")()).toBeUndefined();

		const failing = gitStub([ROOT, ["rev-parse --abbrev-ref HEAD", { code: 1 }], ["rev-parse --verify", { code: 1 }]]);
		expect(await createGitStatus(createFakePi({ exec: failing.exec }).pi, "/repo")()).toBeUndefined();

		const throwing = createFakePi({
			exec: async () => {
				throw new Error("boom");
			},
		}).pi;
		expect(await createGitStatus(throwing, "/repo")()).toBeUndefined();
	});

	test("caches within the TTL and refreshes after it", async () => {
		const clock = makeClock(1000);
		const stub = gitStub([ROOT, ["rev-parse --abbrev-ref HEAD", { stdout: "main\n" }]]);
		const provider = createGitStatus(createFakePi({ exec: stub.exec }).pi, "/repo", {
			ttlMs: 500,
			now: clock.now,
		});

		await provider();
		const afterFirst = stub.calls();
		await provider();
		expect(stub.calls()).toBe(afterFirst);

		clock.advance(600);
		await provider();
		expect(stub.calls()).toBeGreaterThan(afterFirst);
	});
});

describe("git diff provider", () => {
	test("lists changed files for a mode with its stat and totals", async () => {
		const stub = gitStub([
			ROOT,
			HEAD_OK,
			["status --porcelain=v1", { stdout: " M a.txt\0?? new file.txt\0" }],
			[
				"diff --no-color --stat HEAD --",
				{ stdout: " a.txt | 4 +-\n 1 file changed, 5 insertions(+), 3 deletions(-)\n" },
			],
		]);
		const diff = createGitDiff(createFakePi({ exec: stub.exec }).pi, "/repo");
		const list = await diff.list("head");
		expect(list?.mode).toBe("head");
		expect(list?.files.map((file) => file.rel)).toEqual(["a.txt", "new file.txt"]);
		expect(list?.stat).toContain("1 file changed");
		expect(list?.insertions).toBe(5);
		expect(list?.deletions).toBe(3);
	});

	test("reads the totals from the single --stat pass", async () => {
		let diffs = 0;
		const exec = async (_command: string, args: string[]) => {
			const key = args.join(" ");
			if (key.startsWith("rev-parse --show-toplevel")) return { stdout: "/repo\n", stderr: "", code: 0 };
			if (key.startsWith("rev-parse --verify")) return { stdout: "abc1234\n", stderr: "", code: 0 };
			if (key.startsWith("status --porcelain=v1")) return { stdout: " M a.txt\0", stderr: "", code: 0 };
			if (key.startsWith("diff --no-color")) {
				diffs++;
				return {
					stdout: " a.txt | 4 +-\n 1 file changed, 5 insertions(+), 3 deletions(-)\n",
					stderr: "",
					code: 0,
				};
			}
			return { stdout: "", stderr: "unexpected", code: 1 };
		};
		const diff = createGitDiff(createFakePi({ exec }).pi, "/repo");
		const list = await diff.list("head");
		expect(diffs).toBe(1);
		expect(list?.insertions).toBe(5);
		expect(list?.deletions).toBe(3);
	});

	test("reports zero totals when the stat is empty", async () => {
		const stub = gitStub([
			ROOT,
			HEAD_OK,
			["status --porcelain=v1", { stdout: " M a.bin\0" }],
			["diff --no-color --stat", { stdout: "" }],
		]);
		const list = await createGitDiff(createFakePi({ exec: stub.exec }).pi, "/repo").list("head");
		expect(list?.insertions).toBe(0);
		expect(list?.deletions).toBe(0);
	});

	test("filters the list to the column each mode compares", async () => {
		const stub = gitStub([
			ROOT,
			HEAD_OK,
			["status --porcelain=v1", { stdout: " M a.txt\0M  b.txt\0?? c.txt\0" }],
			["diff --no-color --stat", { stdout: "" }],
		]);
		const diff = createGitDiff(createFakePi({ exec: stub.exec }).pi, "/repo");
		expect((await diff.list("staged"))?.files.map((file) => file.rel)).toEqual(["b.txt"]);
		expect((await diff.list("worktree"))?.files.map((file) => file.rel)).toEqual(["a.txt", "c.txt"]);
	});

	test("parses a per-file diff and requests a literal pathspec", async () => {
		let literal: string | undefined;
		const exec = async (_command: string, args: string[]) => {
			const key = args.join(" ");
			if (key.startsWith("rev-parse --show-toplevel")) return { stdout: "/repo\n", stderr: "", code: 0 };
			if (key.startsWith("rev-parse --verify")) return { stdout: "abc1234\n", stderr: "", code: 0 };
			if (key.startsWith("status --porcelain=v1")) return { stdout: " M a.ts\0", stderr: "", code: 0 };
			if (key.startsWith("diff --no-color -U3")) {
				literal = process.env.GIT_LITERAL_PATHSPECS;
				return { stdout: "@@ -1 +1 @@\n-old\n+new\n", stderr: "", code: 0 };
			}
			return { stdout: "", stderr: "unexpected", code: 1 };
		};
		const diff = createGitDiff(createFakePi({ exec }).pi, "/repo");
		const file = await diff.file("a.ts", "head");
		expect(file?.lines.map((line) => line.kind)).toEqual(["hunk", "del", "add"]);
		expect(literal).toBe("1");
	});

	test("renders an untracked file as an all-add diff", async () => {
		const base = root();
		const stub = gitStub([ROOT, HEAD_OK, ["status --porcelain=v1", { stdout: "?? a.txt\0" }]]);
		const diff = createGitDiff(createFakePi({ exec: stub.exec }).pi, base);
		const file = await diff.file("a.txt", "worktree");
		expect(file?.binary).toBe(false);
		expect(file?.lines).toEqual([
			{ kind: "add", text: "hello", newNo: 1 },
			{ kind: "add", text: "world", newNo: 2 },
		]);
	});

	test("falls back to the index when there is no commit", async () => {
		const seen: string[] = [];
		const exec = async (_command: string, args: string[]) => {
			const key = args.join(" ");
			if (key.startsWith("rev-parse --show-toplevel")) return { stdout: "/repo\n", stderr: "", code: 0 };
			if (key.startsWith("rev-parse --verify")) return { stdout: "", stderr: "", code: 1 };
			if (key.startsWith("status --porcelain=v1")) return { stdout: "A  s.txt\0", stderr: "", code: 0 };
			if (key.startsWith("diff --no-color --stat")) {
				seen.push(key);
				return { stdout: "", stderr: "", code: 0 };
			}
			return { stdout: "", stderr: "unexpected", code: 1 };
		};
		const list = await createGitDiff(createFakePi({ exec }).pi, "/repo").list("head");
		expect(list?.files.map((file) => file.rel)).toEqual(["s.txt"]);
		expect(seen[0]).toContain("--cached");
		expect(seen[0]).not.toContain("HEAD");
	});

	test("returns undefined outside a repository or on failure", async () => {
		const outside = gitStub([["rev-parse --show-toplevel", { code: 128 }]]);
		const diff = createGitDiff(createFakePi({ exec: outside.exec }).pi, "/repo");
		expect(await diff.list("head")).toBeUndefined();
		expect(await diff.file("a.ts", "head")).toBeUndefined();

		const throwing = createFakePi({
			exec: async () => {
				throw new Error("boom");
			},
		}).pi;
		expect(await createGitDiff(throwing, "/repo").list("head")).toBeUndefined();
	});

	test("caches the status list within the TTL", async () => {
		const clock = makeClock(1000);
		let statusCalls = 0;
		const exec = async (_command: string, args: string[]) => {
			const key = args.join(" ");
			if (key.startsWith("rev-parse --show-toplevel")) return { stdout: "/repo\n", stderr: "", code: 0 };
			if (key.startsWith("rev-parse --verify")) return { stdout: "abc1234\n", stderr: "", code: 0 };
			if (key.startsWith("status --porcelain=v1")) {
				statusCalls++;
				return { stdout: " M a.txt\0", stderr: "", code: 0 };
			}
			if (key.startsWith("diff --no-color --stat")) return { stdout: "", stderr: "", code: 0 };
			return { stdout: "", stderr: "unexpected", code: 1 };
		};
		const diff = createGitDiff(createFakePi({ exec }).pi, "/repo", { ttlMs: 500, now: clock.now });
		await diff.list("head");
		await diff.list("staged");
		expect(statusCalls).toBe(1);
		clock.advance(600);
		await diff.list("head");
		expect(statusCalls).toBe(2);
	});
});

/**
 * Today's ranking, restated independently: rank every path, sort them all, keep
 * the first `limit`. The bounded window must agree exactly.
 */
function referenceSearch(query: string, paths: readonly string[], limit: number): FuzzyResult[] {
	if (query.trim() === "" || limit <= 0) return [];
	const scored = paths
		.map((path) => ({ path, match: fuzzyMatch(query.trim(), path) }))
		.filter(
			(entry): entry is { path: string; match: NonNullable<ReturnType<typeof fuzzyMatch>> } =>
				entry.match !== undefined,
		)
		.map(({ path, match }) => ({ path, positions: match.positions, score: match.score }));
	scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path));
	return scored.slice(0, limit).map(({ path, positions }) => ({ path, positions }));
}

/** A fixed-seed generator, so the corpus is the same on every run and platform. */
function corpus(count: number): string[] {
	let seed = 0x5f3759df;
	const next = (): number => {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		return seed / 0x7fffffff;
	};
	const dirs = ["src", "lib", "test", "docs", "core/api", "a", "components/forms"];
	const names = ["readme", "index", "file", "panel", "bridge", "model", "render", "a"];
	const exts = [".ts", ".md", ".json", ""];
	return Array.from({ length: count }, (_, index) => {
		const dir = dirs[Math.floor(next() * dirs.length)];
		const name = names[Math.floor(next() * names.length)];
		const ext = exts[Math.floor(next() * exts.length)];
		return `${dir}/n${index % 13}/${name}${index}${ext}`;
	});
}

describe("fuzzy matching", () => {
	test("matches a subsequence and returns its positions", () => {
		expect(fuzzyMatch("rme", "README.md")?.positions).toEqual([0, 4, 5]);
	});

	test("is case-insensitive but rewards exact case", () => {
		expect(fuzzyMatch("readme", "README.md")).toBeDefined();
		const exact = fuzzyMatch("R", "README.md");
		const loose = fuzzyMatch("r", "README.md");
		expect(exact && loose && exact.score > loose.score).toBe(true);
	});

	test("returns undefined when the query is not a subsequence", () => {
		expect(fuzzyMatch("zzz", "README.md")).toBeUndefined();
		expect(fuzzyMatch("mer", "README.md")).toBeUndefined();
	});

	test("treats an empty query as a scoreless match and an over-long one as no match", () => {
		expect(fuzzyMatch("", "a.ts")).toEqual({ score: 0, positions: [] });
		expect(fuzzyMatch("a".repeat(300), "a".repeat(300))).toBeUndefined();
	});

	test("ranks a basename match above a directory match", () => {
		expect(fuzzySearch("readme", ["readme/something.ts", "src/readme.ts"], 10)[0]?.path).toBe("src/readme.ts");
	});

	test("returns nothing for an empty query", () => {
		expect(fuzzySearch("", ["a.ts"], 10)).toEqual([]);
		expect(fuzzySearch("   ", ["a.ts"], 10)).toEqual([]);
	});

	test("caps results and preserves matched positions", () => {
		const paths = Array.from({ length: 10 }, (_, index) => `file-${index}.ts`);
		const results = fuzzySearch("file", paths, 3);
		expect(results).toHaveLength(3);
		expect(results[0]?.positions).toEqual([0, 1, 2, 3]);
	});

	test("agrees with a full sort on a fixed corpus, at every cap", () => {
		const paths = corpus(500);
		for (const query of ["a", "re", "render", "n1", "forms", "zz", "."]) {
			for (const limit of [1, 2, 7, 50, 600]) {
				expect(fuzzySearch(query, paths, limit)).toEqual(referenceSearch(query, paths, limit));
			}
		}
	});

	test("breaks an equal score by length, then by the path itself", () => {
		const paths = ["ab/c.ts", "ac/b.ts", "aa/d.ts"];
		const forward = fuzzySearch("a", paths, 3);
		const reversed = fuzzySearch("a", [...paths].reverse(), 3);
		expect(forward).toEqual(referenceSearch("a", paths, 3));
		expect(reversed).toEqual(forward);

		const tied = ["Ab.ts", "ab.ts"];
		expect(fuzzySearch("a", tied, 2)).toEqual(referenceSearch("a", tied, 2));
	});

	test("does not reorder the array it was given", () => {
		const paths = ["c.ts", "a.ts", "b.ts"];
		fuzzySearch("ts", paths, 2);
		expect(paths).toEqual(["c.ts", "a.ts", "b.ts"]);
	});
});

describe("icon table", () => {
	test("maps languages, docs, config, archives, and images", () => {
		expect(languageOf("a.ts")).toMatchObject({ icon: "file-code", label: "TypeScript" });
		expect(languageOf("a.PY")).toMatchObject({ icon: "file-code", label: "Python" });
		expect(languageOf("README.md")).toMatchObject({ icon: "file-text", colorClass: "doc" });
		expect(languageOf("package.json")).toMatchObject({ icon: "file-json", colorClass: "cfg" });
		expect(languageOf("bundle.zip")).toMatchObject({ icon: "file-archive", colorClass: "arc" });
		expect(languageOf("logo.png")).toMatchObject({ icon: "file-image", colorClass: "img" });
	});

	test("recognizes dotfiles and falls back to a generic file", () => {
		expect(languageOf(".env")).toMatchObject({ colorClass: "cfg" });
		expect(languageOf("mystery")).toMatchObject({ icon: "file", label: "File" });
	});

	test("ships a sprite symbol for every icon the mapping can return", () => {
		const names = [
			FOLDER_ICON.icon,
			languageOf("a.ts").icon,
			languageOf("a.md").icon,
			languageOf("a.json").icon,
			languageOf("a.zip").icon,
			languageOf("a.png").icon,
			languageOf("mystery").icon,
		];
		for (const name of names) {
			expect(SPRITE).toContain(`id="i-${name}"`);
			expect(iconHref(name)).toBe(`#i-${name}`);
		}
	});
});
