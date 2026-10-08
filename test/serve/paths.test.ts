import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	HttpError,
	isInside,
	relativePath,
	resolveDecodedPath,
	resolveRequestPath,
} from "../../extensions/serve/paths.ts";
import { makeFixture, type Fixture } from "./helpers.ts";

let fixture: Fixture | undefined;

afterEach(() => {
	fixture?.remove();
	fixture = undefined;
});

describe("isInside", () => {
	test("accepts the root and descendants", () => {
		expect(isInside("/a/b", "/a/b")).toBe(true);
		expect(isInside("/a/b", "/a/b/c")).toBe(true);
	});

	test("rejects siblings and parents", () => {
		expect(isInside("/a/b", "/a/c")).toBe(false);
		expect(isInside("/a/b", "/a")).toBe(false);
		expect(isInside("/a/b", "/a/bc")).toBe(false);
	});
});

describe("resolveRequestPath", () => {
	test("resolves the root, files, and folders", async () => {
		fixture = makeFixture();
		const root = fixture.root;
		expect(await resolveRequestPath(root, "/")).toBe(root);
		expect(await resolveRequestPath(root, "/a.txt")).toBe(join(root, "a.txt"));
		expect(await resolveRequestPath(root, "sub")).toBe(join(root, "sub"));
	});

	test("rejects traversal, encoded or not", async () => {
		fixture = makeFixture();
		const root = fixture.root;
		await expect(resolveRequestPath(root, "../outside/secret.txt")).rejects.toBeInstanceOf(HttpError);
		await expect(resolveRequestPath(root, "%2e%2e/outside/secret.txt")).rejects.toBeInstanceOf(HttpError);
	});

	test("rejects NUL bytes and malformed escapes", async () => {
		fixture = makeFixture();
		const root = fixture.root;
		await expect(resolveRequestPath(root, "a.txt%00")).rejects.toMatchObject({ status: 400 });
		await expect(resolveRequestPath(root, "bad%zz")).rejects.toMatchObject({ status: 400 });
	});

	test("rejects Windows-style absolute paths", async () => {
		fixture = makeFixture();
		await expect(resolveRequestPath(fixture.root, "C:/Windows")).rejects.toMatchObject({ status: 403 });
	});

	test("blocks a symlink that points outside the root", async () => {
		fixture = makeFixture();
		if (!fixture.hasSymlinks) return;
		await expect(resolveRequestPath(fixture.root, "escape.txt")).rejects.toMatchObject({ status: 403 });
	});

	test("allows a symlink that stays inside the root", async () => {
		fixture = makeFixture();
		if (!fixture.hasSymlinks) return;
		expect(await resolveRequestPath(fixture.root, "link.txt")).toBe(join(fixture.root, "a.txt"));
	});

	test("allows a missing leaf for a later 404", async () => {
		fixture = makeFixture();
		expect(await resolveRequestPath(fixture.root, "missing.txt")).toBe(join(fixture.root, "missing.txt"));
	});
});

describe("resolveDecodedPath", () => {
	test("does not decode a second time", async () => {
		fixture = makeFixture();
		const resolved = await resolveDecodedPath(fixture.root, "a.txt");
		expect(resolved).toBe(join(fixture.root, "a.txt"));
		await expect(resolveDecodedPath(fixture.root, "../x")).rejects.toMatchObject({ status: 403 });
	});
});

describe("relativePath", () => {
	test("returns posix separators and an empty root", () => {
		expect(relativePath("/a/b", "/a/b")).toBe("");
		expect(relativePath("/a/b", "/a/b/c/d")).toBe("c/d");
	});
});
