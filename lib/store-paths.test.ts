/**
 * The mover: the four cases a store's first read after an upgrade depends on.
 *
 * Every case runs against a real directory, because the properties that matter — a rename that
 * crosses nothing, a directory left exactly as it was, a failed move leaving the old one readable
 * — are properties of the filesystem rather than of a mock.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "../test/helpers/env.ts";
import { makeTempTracker } from "../test/helpers/git.ts";
import { migrateStoreDir } from "./store-paths.ts";
import { isInside, isInsideReal } from "./path.ts";

const temps = makeTempTracker();

/** A store with one file in it, at `dir`. */
function storeAt(dir: string, content = "a card"): string {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "0004.json"), content);
	return dir;
}

describe("migrateStoreDir", () => {
	test("moves an old store to its new home when the new one is missing", async () => {
		const from = storeAt(temps.track(tempDir("pi-migrate-old-")));
		const to = join(temps.track(tempDir("pi-migrate-new-")), "repos", "abc", "board");
		expect(await migrateStoreDir(from, to)).toBe("moved");
		// The state is at the new home, and the old directory is gone rather than duplicated.
		expect(readFileSync(join(to, "0004.json"), "utf-8")).toBe("a card");
		expect(existsSync(from)).toBe(false);
	});

	test("leaves the old one alone when the new home already exists", async () => {
		const from = storeAt(temps.track(tempDir("pi-migrate-old-")), "old");
		const to = storeAt(temps.track(tempDir("pi-migrate-new-")), "new");
		expect(await migrateStoreDir(from, to)).toBe("already-moved");
		expect(readFileSync(join(to, "0004.json"), "utf-8")).toBe("new");
		expect(readFileSync(join(from, "0004.json"), "utf-8")).toBe("old");
	});

	test("answers nothing-to-move for a fresh install", async () => {
		const from = join(temps.track(tempDir("pi-migrate-old-")), "absent");
		const to = join(temps.track(tempDir("pi-migrate-new-")), "repos", "abc", "board");
		expect(await migrateStoreDir(from, to)).toBe("nothing-to-move");
		expect(existsSync(to)).toBe(false);
	});

	test("is idempotent: the second run finds the new home and moves nothing", async () => {
		const from = storeAt(temps.track(tempDir("pi-migrate-old-")));
		const to = join(temps.track(tempDir("pi-migrate-new-")), "repos", "abc", "board");
		expect(await migrateStoreDir(from, to)).toBe("moved");
		expect(await migrateStoreDir(from, to)).toBe("already-moved");
		expect(readFileSync(join(to, "0004.json"), "utf-8")).toBe("a card");
	});

	test.skipIf(process.platform === "win32")("keeps a file's 0600 through the move", async () => {
		// The memory store is one file with the user's eyes only, and a move is the one moment it
		// could widen: `rename` keeps the mode, and this is the case that says so.
		const from = join(temps.track(tempDir("pi-migrate-old-")), "memory.md");
		mkdirSync(dirname(from), { recursive: true });
		writeFileSync(from, "- a note\n", { mode: 0o600 });
		const to = join(temps.track(tempDir("pi-migrate-new-")), "repos", "abc", "memory.md");
		expect(await migrateStoreDir(from, to)).toBe("moved");
		expect(statSync(to).mode & 0o777).toBe(0o600);
	});

	test("answers failed and leaves the old store readable when the target cannot be made", async () => {
		const from = storeAt(temps.track(tempDir("pi-migrate-old-")));
		// A regular file where the parent directory has to go: mkdir fails, and the old store must
		// survive it, because a failed move is the case an existing install cannot afford to lose.
		const blocker = join(temps.track(tempDir("pi-migrate-blocked-")), "file");
		writeFileSync(blocker, "not a directory");
		const to = join(blocker, "repos", "abc", "board");
		expect(await migrateStoreDir(from, to)).toBe("failed");
		expect(readFileSync(join(from, "0004.json"), "utf-8")).toBe("a card");
	});
});

describe("the layout's promise", () => {
	test("never resolves a repository's store inside the repository", async () => {
		// The property this card exists for, as a case: a store a sync client may replicate cannot
		// live in the checkout it belongs to, or the two machines' copies would be dirs apart. The
		// case that first caught it was a job registry written into the worktree root by a caller
		// that handed the repository root where a `repos/<id>` directory was expected.
		const { repoStoreDir } = await import("./repo-key.ts");
		const repo = temps.track(tempDir("pi-layout-repo-"));
		const agentDir = temps.track(tempDir("pi-layout-agent-"));
		const dir = repoStoreDir(agentDir, "5f3c8a1b2d4e", "board");
		expect(isInside(repo, dir)).toBe(false);
		expect(isInsideReal(repo, dir)).toBe(false);
		// And it is inside the agent directory, where the other machine's copy of it belongs.
		expect(isInside(agentDir, dir)).toBe(true);
	});
});
