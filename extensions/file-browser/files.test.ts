import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	buildTree,
	classifyByName,
	contentTypeFor,
	formatSize,
	isImageName,
	isProbablyText,
	listDirectory,
	readFileView,
	type TreeNode,
} from "./files.ts";
import { makeFixture, type Fixture } from "../../test/helpers/fixtures/file-browser.ts";

let fixture: Fixture | undefined;

afterEach(() => {
	fixture?.remove();
	fixture = undefined;
});

describe("classifyByName", () => {
	test("classifies images, text, and binary", () => {
		expect(classifyByName("a.png")).toBe("image");
		expect(classifyByName("a.ts")).toBe("text");
		expect(classifyByName("README.md")).toBe("text");
		expect(classifyByName(".gitignore")).toBe("text");
		expect(classifyByName("logo.bin")).toBe("binary");
	});

	test("recognizes extensionless names", () => {
		expect(classifyByName("LICENSE")).toBe("text");
		expect(classifyByName("Makefile")).toBe("text");
		expect(classifyByName("mystery")).toBe("binary");
	});
});

describe("isImageName", () => {
	test("matches common image extensions", () => {
		expect(isImageName("a.PNG")).toBe(true);
		expect(isImageName("a.svg")).toBe(true);
		expect(isImageName("a.txt")).toBe(false);
	});
});

describe("isProbablyText", () => {
	test("accepts UTF-8 text and rejects NUL bytes", () => {
		expect(isProbablyText(Buffer.from("hello\nworld"))).toBe(true);
		expect(isProbablyText(Buffer.from([0, 1, 2, 3]))).toBe(false);
		expect(isProbablyText(Buffer.alloc(0))).toBe(true);
	});
});

describe("formatSize", () => {
	test("formats bytes and units", () => {
		expect(formatSize(0)).toBe("0 B");
		expect(formatSize(68)).toBe("68 B");
		expect(formatSize(12_400)).toBe("12 kB");
		expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
	});
});

describe("contentTypeFor", () => {
	test("maps image types and defaults binary to octet-stream", () => {
		expect(contentTypeFor("a.png")).toBe("image/png");
		expect(contentTypeFor("a.svg")).toBe("image/svg+xml");
		expect(contentTypeFor("a.zip")).toBe("application/octet-stream");
	});
});

describe("listDirectory", () => {
	test("sorts directories first, then names case-insensitively", async () => {
		fixture = makeFixture();
		const listing = await listDirectory(fixture.root, "", 100);
		const names = listing.entries.map((entry) => entry.name);
		expect(names[0]).toBe("sub");
		const fileNames = names.slice(1);
		expect(fileNames).toEqual([...fileNames].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
	});

	test("marks symlinks and images", async () => {
		fixture = makeFixture();
		const listing = await listDirectory(fixture.root, "", 100);
		const link = listing.entries.find((entry) => entry.name === "link.txt");
		const image = listing.entries.find((entry) => entry.name === "image.png");
		if (link) expect(link.isSymlink).toBe(true);
		expect(image?.isImage).toBe(true);
	});

	test("caps entries and reports the total", async () => {
		fixture = makeFixture();
		const listing = await listDirectory(fixture.root, "", 2);
		expect(listing.entries).toHaveLength(2);
		expect(listing.truncated).toBe(true);
		expect(listing.total).toBeGreaterThan(2);
	});
});

describe("readFileView", () => {
	test("reads text into lines", async () => {
		fixture = makeFixture();
		const view = await readFileView(fixture.root, "a.txt", 1_000_000, 100);
		expect(view.kind).toBe("text");
		if (view.kind !== "text") return;
		expect(view.lines).toEqual(["hello", "world", ""]);
		expect(view.truncated).toBe(false);
	});

	test("truncates long text", async () => {
		fixture = makeFixture();
		const view = await readFileView(fixture.root, "big.txt", 1_000_000, 4);
		expect(view.kind).toBe("text");
		if (view.kind !== "text") return;
		expect(view.truncated).toBe(true);
		expect(view.totalLines).toBeGreaterThan(4);
	});

	test("classifies images, binary, and over-size files", async () => {
		fixture = makeFixture();
		expect((await readFileView(fixture.root, "image.png", 1_000_000, 100)).kind).toBe("image");
		expect((await readFileView(fixture.root, "bin.dat", 1_000_000, 100)).kind).toBe("binary");
		expect((await readFileView(fixture.root, "big.txt", 10, 100)).kind).toBe("tooLarge");
	});
});

describe("buildTree", () => {
	test("expands the current path's ancestors", async () => {
		fixture = makeFixture();
		const tree = await buildTree(fixture.root, "sub", 100);
		const sub = tree.children.find((node) => node.name === "sub");
		expect(sub?.children.map((node) => node.name)).toContain("b.md");
	});

	test("leaves siblings collapsed", async () => {
		fixture = makeFixture();
		const tree = await buildTree(fixture.root, "sub", 100);
		const file = tree.children.find((node) => node.name === "a.txt");
		expect(file?.children).toHaveLength(0);
		expect(file?.isDir).toBe(false);
	});

	test("reveals the full active path at any depth", async () => {
		fixture = makeFixture();
		mkdirSync(join(fixture.root, "a", "b", "c", "d", "e"), { recursive: true });
		writeFileSync(join(fixture.root, "a", "b", "c", "d", "e", "f.txt"), "deep\n");
		const tree = await buildTree(fixture.root, "a/b/c/d/e/f.txt", 100);
		let node: TreeNode = tree;
		for (const name of ["a", "b", "c", "d", "e"]) {
			const child = node.children.find((item) => item.name === name);
			if (!child) throw new Error(`missing ${name}`);
			expect(child.isDir).toBe(true);
			node = child;
		}
		expect(node.children.map((child) => child.name)).toContain("f.txt");
	});

	test("marks a dangling symlink as broken", async () => {
		fixture = makeFixture();
		if (!fixture.hasSymlinks) return;
		try {
			symlinkSync(join(fixture.root, "does-not-exist"), join(fixture.root, "dangling"));
		} catch {
			return;
		}
		const tree = await buildTree(fixture.root, "dangling", 100);
		const node = tree.children.find((child) => child.name === "dangling");
		expect(node?.broken).toBe(true);
	});
});
