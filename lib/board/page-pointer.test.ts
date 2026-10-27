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
	settlePointer,
	urlOf,
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
		token: "0123456789abcdef0123456789abcdef",
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
		expect(urlOf(pointer())).toBe("http://127.0.0.1:4781/board/?token=0123456789abcdef0123456789abcdef");
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
		const second = await createPointer(dir, pointer({ port: 4782, token: "ffffffffffffffffffffffffffffffff" }));
		expect([first, second]).toEqual([true, false]);
		// The winner's note is untouched, which is what the loser reads to attach.
		expect((await readPointer(dir))?.port).toBe(4781);
	});

	test("a note is cleared by the page that wrote it, and only by that one", async () => {
		const dir = scratch();
		await createPointer(dir, pointer());
		expect(await clearPointer(dir, "ffffffffffffffffffffffffffffffff")).toBe(false);
		expect(await readPointer(dir)).toBeDefined();
		expect(await clearPointer(dir, pointer().token)).toBe(true);
		expect(await readPointer(dir)).toBeUndefined();
	});

	test("clearing a note that is not there is not an error", async () => {
		expect(await clearPointer(scratch(), pointer().token)).toBe(false);
	});
});

describe("settling the note for a page that is starting", () => {
	const live = async () => ({ ok: true });
	const dead = async () => ({ ok: false });

	test("writes when the name is free, and reports no dead note", async () => {
		const dir = scratch();
		expect(await settlePointer(dir, pointer(), dead)).toEqual({ kind: "written" });
		expect((await readPointer(dir))?.token).toBe(pointer().token);
	});

	test("attaches to the page that is already answering", async () => {
		const dir = scratch();
		const winner = pointer({ port: 4782, token: "ffffffffffffffffffffffffffffffff" });
		await createPointer(dir, winner);
		expect(await settlePointer(dir, pointer(), live)).toEqual({ kind: "attached", pointer: winner });
		// The winner's note is untouched: attaching never rewrites it.
		expect(await readPointer(dir)).toEqual(winner);
	});

	test("takes over a note that answers nobody, and says which one it was", async () => {
		const dir = scratch();
		const gone = pointer({ port: 4783, token: "dddddddddddddddddddddddddddddddd" });
		await createPointer(dir, gone);
		const outcome = await settlePointer(dir, pointer(), dead);
		expect(outcome).toEqual({ kind: "written", took: gone });
		expect((await readPointer(dir))?.token).toBe(pointer().token);
	});

	test("loses the takeover to another session, then attaches to the page that won", async () => {
		const dir = scratch();
		// A page that died and left its note behind.
		await createPointer(dir, pointer({ token: "dddddddddddddddddddddddddddddddd" }));
		// The race: this caller proves the note dead, and another session replaces it in the
		// window before the clear — so the clear is refused, and the next attempt finds a page
		// that answers. Before this, that caller was told "another session is serving" and
		// never opened anything.
		const winner = pointer({ port: 4784, token: "ffffffffffffffffffffffffffffffff" });
		const outcome = await settlePointer(dir, pointer({ port: 4785 }), async (url) => {
			if (url.includes(":4781/")) {
				// The dead note: every look says so, and another session replaces the file while
				// this caller is still waiting on it.
				writeFileSync(join(dir, PAGE_FILE), JSON.stringify(winner));
				return { ok: false };
			}
			return { ok: true };
		});
		expect(outcome).toEqual({ kind: "attached", pointer: winner });
		expect(await readPointer(dir)).toEqual(winner);
	});

	test("waits for a page still coming up instead of taking its note", async () => {
		const dir = scratch();
		// A note is written before its server can accept a connection, so the first look at a
		// page that started a moment ago is refused. That is not proof of death: stealing the
		// note serves a second page, and calling it stale reports a page that exists as one
		// that did not start.
		const winner = pointer({ port: 4793, token: "f".repeat(32) });
		await createPointer(dir, winner);
		let probes = 0;
		const outcome = await settlePointer(dir, pointer({ port: 4794 }), async (url) => {
			if (!url.includes(":4793/")) return { ok: false };
			probes += 1;
			return { ok: probes > 1 };
		});
		expect(outcome).toEqual({ kind: "attached", pointer: winner });
		expect(await readPointer(dir)).toEqual(winner);
	});

	test("two sessions starting together never both serve", async () => {
		// The window a read-then-unlink leaves open: one caller proves the old note dead
		// and removes the name, deleting the note a faster caller had just written. Both
		// then serve, and only one of the two pages is findable.
		for (let round = 0; round < 5; round++) {
			const dir = scratch();
			await createPointer(dir, pointer({ port: 4783, token: "d".repeat(32) }));
			const probe = async (url: string) => ({ ok: !url.includes(":4783/") });
			const outcomes = await Promise.all([
				settlePointer(dir, pointer({ port: 4790, token: "a".repeat(32) }), probe),
				settlePointer(dir, pointer({ port: 4791, token: "b".repeat(32) }), probe),
			]);
			const served = outcomes.filter((outcome) => outcome.kind === "written");
			expect(served.length, `round ${round}: ${JSON.stringify(outcomes)}`).toBe(1);
		}
	});

	test("names an unreadable note instead of blaming a session", async () => {
		const dir = scratch();
		writeFileSync(join(dir, PAGE_FILE), "{ not a pointer");
		expect(await settlePointer(dir, pointer(), dead)).toEqual({ kind: "unreadable" });
		// Nothing was cleared: the file is the user's to look at, not this caller's to guess at.
		expect(readFileSync(join(dir, PAGE_FILE), "utf-8")).toBe("{ not a pointer");
	});

	test("gives up as stale, naming the note, when every attempt meets a dead one", async () => {
		const dir = scratch();
		// A note whose token changes on every probe: no clear can ever land, which is what a
		// third session racing this caller looks like from here.
		let rival = pointer({ token: "d".repeat(32) });
		writeFileSync(join(dir, PAGE_FILE), JSON.stringify(rival));
		let probes = 0;
		const outcome = await settlePointer(dir, pointer(), async () => {
			probes += 1;
			rival = pointer({ port: 4790 + probes, token: `${probes}`.repeat(32).slice(0, 32) });
			writeFileSync(join(dir, PAGE_FILE), JSON.stringify(rival));
			return { ok: false };
		});
		expect(probes).toBeGreaterThan(1);
		expect(outcome).toEqual({ kind: "stale", pointer: rival });
		// Nothing was cleared on the final pass: the file is still somebody else's to explain.
		expect(await readPointer(dir)).toEqual(rival);
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
			JSON.stringify({ ...pointer(), token: "" }),
			JSON.stringify({ ...pointer(), seat: { label: "" } }),
			JSON.stringify({ ...pointer(), seat: { id: 7, label: "team-lead" } }),
			JSON.stringify({ ...pointer(), startedAt: "then" }),
			"null",
		]) {
			writeFileSync(join(dir, PAGE_FILE), body);
			expect(await readPointer(dir), body).toBeUndefined();
		}
	});

	test("a note written with the old view token is this page's, so an upgrade still serves", async () => {
		// The build before this one wrote two credentials; the note carried the read-only one.
		// A reader that only knew `token` would refuse its own note and stop the page.
		const dir = scratch();
		const { token, ...rest } = pointer();
		writeFileSync(join(dir, PAGE_FILE), JSON.stringify({ ...rest, viewToken: token }));
		expect(await readPointer(dir)).toEqual(pointer());
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
	test("asks the cheap liveness route, with the page's token", async () => {
		const asked: string[] = [];
		const live = await probePage(pointer(), async (url) => {
			asked.push(url);
			return { ok: true };
		});
		expect(live).toBe(true);
		// Not the snapshot: a probe must not queue behind the page's own view on a busy
		// event loop, which is how a live page got declared dead.
		expect(asked).toEqual(["http://127.0.0.1:4781/board/api/ping?token=0123456789abcdef0123456789abcdef"]);
	});

	test("falls back to the snapshot for a page from a build without the ping", async () => {
		const asked: string[] = [];
		const live = await probePage(pointer(), async (url) => {
			asked.push(url);
			return url.includes("/api/ping") ? { ok: false, status: 404 } : { ok: true };
		});
		expect(live).toBe(true);
		expect(asked.map((url) => new URL(url).pathname)).toEqual(["/board/api/ping", "/board/api/board"]);
	});

	test("a page that refuses the token, or is gone, is not one to attach to", async () => {
		expect(await probePage(pointer(), async () => ({ ok: false, status: 403 }))).toBe(false);
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
