import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createTempIndexStore } from "./temp-index.ts";
import { cleanup, makeRepo } from "../../test/helpers/git.ts";
import { runGit } from "../../test/helpers/fixtures/rewind.ts";

const cleanups: string[] = [];
afterAll(() => cleanup(...cleanups));

describe("createTempIndexStore", () => {
	test("pathFor creates the pi dir and returns a stable per-process path", async () => {
		const repo = await makeRepo("pi-rw-index-path-");
		cleanups.push(repo);
		const store = createTempIndexStore(runGit);

		const first = await store.pathFor(repo);
		expect(first).toBe(join(repo, ".git", "pi", `rewind-index-${process.pid}`));
		expect(existsSync(dirname(first))).toBe(true);
		expect(await store.pathFor(repo)).toBe(first);
	});

	test("release deletes the files it created", async () => {
		const repo = await makeRepo("pi-rw-index-release-");
		cleanups.push(repo);
		const store = createTempIndexStore(runGit);

		const file = await store.pathFor(repo);
		writeFileSync(file, ""); // git creates this file on the first stage
		store.release();
		expect(existsSync(file)).toBe(false);

		// The dir survives, so a later session can request the path again.
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
		utimesSync(own, oldSeconds, oldSeconds); // old, but it belongs to this process

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
