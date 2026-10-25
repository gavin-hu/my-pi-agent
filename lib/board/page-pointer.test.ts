/**
 * The page pointer: the note a second session reads to find the page already served.
 *
 * The cases run against a real directory, because the property that matters — one
 * pointer, whoever writes first — is the filesystem's, not a mock's. The probe runs
 * against a stub `fetch`, so a timeout is a throw and not a wait.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import {
	clearPointer,
	createPointer,
	PAGE_FILE,
	type PagePointer,
	probePage,
	readPointer,
	viewUrlOf,
} from "./page-pointer.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** A fresh board directory. */
function scratch(): string {
	return temps.track(tempDir("pi-board-page-"));
}

/** A pointer as the page writes it. */
function pointer(overrides: Partial<PagePointer> = {}): PagePointer {
	return {
		port: 4781,
		viewToken: "0123456789abcdef0123456789abcdef",
		seat: { id: "board:team-lead", label: "team-lead" },
		startedAt: 1_000,
		...overrides,
	};
}

describe("the pointer file", () => {
	test("round-trips the page a session started", async () => {
		const dir = scratch();
		expect(await createPointer(dir, pointer())).toBe(true);
		expect(await readPointer(dir)).toEqual(pointer());
		expect(viewUrlOf(pointer())).toBe("http://127.0.0.1:4781/?token=0123456789abcdef0123456789abcdef");
	});

	test("is the user's eyes only, like a card file", async () => {
		if (process.platform === "win32") return;
		const dir = scratch();
		await createPointer(dir, pointer());
		expect(statSync(join(dir, PAGE_FILE)).mode & 0o777).toBe(0o600);
	});

	test("one pointer per board: the second session loses and attaches", async () => {
		const dir = scratch();
		const first = await createPointer(dir, pointer());
		const second = await createPointer(dir, pointer({ port: 4782, viewToken: "ffffffffffffffffffffffffffffffff" }));
		expect([first, second]).toEqual([true, false]);
		// The winner's note is untouched, which is what the loser reads to attach.
		expect((await readPointer(dir))?.port).toBe(4781);
	});

	test("a note is cleared by the page that wrote it, and only by that one", async () => {
		const dir = scratch();
		await createPointer(dir, pointer());
		expect(await clearPointer(dir, "ffffffffffffffffffffffffffffffff")).toBe(false);
		expect(await readPointer(dir)).toBeDefined();
		expect(await clearPointer(dir, pointer().viewToken)).toBe(true);
		expect(await readPointer(dir)).toBeUndefined();
	});

	test("clearing a note that is not there is not an error", async () => {
		expect(await clearPointer(scratch(), pointer().viewToken)).toBe(false);
	});
});

describe("a pointer this build cannot trust", () => {
	test("is no pointer at all, rather than a guess", async () => {
		const dir = scratch();
		for (const body of [
			'{"port":',
			"{}",
			JSON.stringify({ ...pointer(), port: 0 }),
			JSON.stringify({ ...pointer(), port: "4781" }),
			JSON.stringify({ ...pointer(), viewToken: "" }),
			JSON.stringify({ ...pointer(), seat: { label: "" } }),
			JSON.stringify({ ...pointer(), seat: { id: 7, label: "team-lead" } }),
			JSON.stringify({ ...pointer(), startedAt: "then" }),
			"null",
		]) {
			writeFileSync(join(dir, PAGE_FILE), body);
			expect(await readPointer(dir), body).toBeUndefined();
		}
	});

	test("a seat without an id is still a seat, so an older note still attaches", async () => {
		const dir = scratch();
		writeFileSync(join(dir, PAGE_FILE), JSON.stringify({ ...pointer(), seat: { label: "team-lead" } }));
		expect(await readPointer(dir)).toEqual({ ...pointer(), seat: { label: "team-lead" } });
	});

	test("a directory with no note says nothing about a page", async () => {
		expect(await readPointer(scratch())).toBeUndefined();
	});
});

describe("probePage", () => {
	test("asks the snapshot route, with the view token", async () => {
		const asked: string[] = [];
		const live = await probePage(pointer(), async (url) => {
			asked.push(url);
			return { ok: true };
		});
		expect(live).toBe(true);
		expect(asked).toEqual(["http://127.0.0.1:4781/api/board?token=0123456789abcdef0123456789abcdef"]);
	});

	test("a page that refuses the token, or is gone, is not one to attach to", async () => {
		expect(await probePage(pointer(), async () => ({ ok: false }))).toBe(false);
		expect(
			await probePage(pointer(), async () => {
				throw new Error("connect ECONNREFUSED");
			}),
		).toBe(false);
	});

	test("waits a short while and no longer", async () => {
		let seen: AbortSignal | undefined;
		await probePage(pointer(), async (_url, init) => {
			seen = init.signal;
			return { ok: true };
		});
		expect(seen).toBeInstanceOf(AbortSignal);
		expect(seen?.aborted).toBe(false);
	});
});

test("the file is written as the note a person can read", async () => {
	const dir = scratch();
	await createPointer(dir, pointer());
	const text = readFileSync(join(dir, PAGE_FILE), "utf-8");
	expect(text).toContain('"label": "team-lead"');
	expect(text.endsWith("\n")).toBe(true);
});
