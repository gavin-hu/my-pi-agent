import { describe, expect, test } from "bun:test";
import { makeClock } from "../../test/helpers/clock.ts";
import { settle } from "../../test/helpers/process.ts";
import { changeIndexOf, createLiveChannel, createLiveStatus, frameOf, type LiveClient } from "./live.ts";
import type { DiffList, GitDiffProvider, GitStatusProvider } from "./git.ts";

/** A change list with one changed file and one deleted file in a folder. */
const LIST: DiffList = {
	mode: "head",
	files: [
		{ rel: "a.txt", index: " ", worktree: "M", untracked: false },
		{ rel: "sub/b.md", index: " ", worktree: "D", untracked: false },
	],
	stat: " a.txt | 2 +-\n 2 files changed, 1 insertion(+), 1 deletion(-)",
	insertions: 1,
	deletions: 1,
};

/** A diff provider answering one fixed list. */
function provider(list: DiffList | undefined = LIST): GitDiffProvider {
	return {
		list: async () => list,
		file: async () => undefined,
	};
}

describe("changeIndexOf", () => {
	test("indexes changed files and the folders above them", () => {
		const index = changeIndexOf(LIST);
		expect(index.count).toBe(2);
		expect([...index.files].sort()).toEqual(["a.txt", "sub/b.md"]);
		expect([...index.dirs]).toEqual(["sub"]);
	});
});

describe("createLiveStatus", () => {
	test("carries the branch, the changes, the uptime, and the request count", async () => {
		const clock = makeClock(10_000);
		const status = createLiveStatus({
			git: async () => ({ branch: "main" }),
			diff: provider(),
			startedAt: 4_000,
			requests: () => 7,
			now: clock.now,
		});
		const snapshot = await status.snapshot();
		expect(snapshot.at).toBe(10_000);
		expect(snapshot.uptimeMs).toBe(6_000);
		expect(snapshot.requests).toBe(7);
		expect(snapshot.git).toEqual({ branch: "main" });
		expect(snapshot.changes).toEqual({
			count: 2,
			insertions: 1,
			deletions: 1,
			files: ["a.txt", "sub/b.md"],
			dirs: ["sub"],
		});
	});

	test("sends a detached head through as it is", async () => {
		const status = createLiveStatus({ git: async () => ({ head: "abc1234" }), startedAt: 0, requests: () => 0 });
		expect((await status.snapshot()).git).toEqual({ head: "abc1234" });
	});

	test("reports null for a non-repository and for a missing provider", async () => {
		const none: GitStatusProvider = async () => undefined;
		const status = createLiveStatus({
			git: none,
			diff: { list: async () => undefined, file: async () => undefined },
			startedAt: 0,
			requests: () => 0,
		});
		const snapshot = await status.snapshot();
		expect(snapshot.git).toBeNull();
		expect(snapshot.changes).toBeNull();

		const bare = await createLiveStatus({ startedAt: 0, requests: () => 0 }).snapshot();
		expect(bare.git).toBeNull();
		expect(bare.changes).toBeNull();
	});

	test("degrades a throwing provider instead of rejecting", async () => {
		const status = createLiveStatus({
			git: async () => {
				throw new Error("git is missing");
			},
			diff: {
				list: async () => {
					throw new Error("no repository");
				},
				file: async () => undefined,
			},
			startedAt: 0,
			requests: () => 0,
		});
		const snapshot = await status.snapshot();
		expect(snapshot.git).toBeNull();
		expect(snapshot.changes).toBeNull();
	});

	test("never reports a negative uptime", async () => {
		const status = createLiveStatus({ startedAt: 5_000, requests: () => 0, now: () => 1_000 });
		expect((await status.snapshot()).uptimeMs).toBe(0);
	});
});

describe("frameOf", () => {
	test("is one named event with the snapshot as JSON", () => {
		const frame = frameOf({
			at: 5,
			uptimeMs: 5,
			requests: 1,
			git: { branch: "main" },
			changes: null,
		});
		expect(frame.startsWith("event: status\ndata: {")).toBe(true);
		expect(frame.endsWith("}\n\n")).toBe(true);
		expect(JSON.parse(frame.slice(frame.indexOf("{"), frame.lastIndexOf("}") + 1))).toEqual({
			at: 5,
			uptimeMs: 5,
			requests: 1,
			git: { branch: "main" },
			changes: null,
		});
	});
});

describe("createLiveChannel", () => {
	/** A connected page that records what it was sent. */
	function client(): LiveClient & { frames: string[]; ends: number } {
		const record = {
			frames: [] as string[],
			ends: 0,
			write: (frame: string) => {
				record.frames.push(frame);
			},
			end: () => {
				record.ends += 1;
			},
		};
		return record;
	}

	/** A timer that only fires when the test says so. */
	function fakeTimer(): { timer: (tick: () => void) => () => void; fire(): Promise<void>; stops: number } {
		let pending: (() => void) | undefined;
		const state = {
			stops: 0,
			timer: (tick: () => void) => {
				pending = tick;
				return () => {
					pending = undefined;
					state.stops += 1;
				};
			},
			fire: async () => {
				pending?.();
				await settle();
			},
		};
		return state;
	}

	test("sends the current status to a page as it attaches", async () => {
		const status = createLiveStatus({ git: async () => ({ branch: "main" }), startedAt: 0, requests: () => 1 });
		const channel = createLiveChannel({ status, intervalMs: 3000, timer: fakeTimer().timer });
		const page = client();
		const detach = channel.attach(page);
		await settle();
		expect(page.frames).toHaveLength(1);
		expect(page.frames[0]).toContain('"branch":"main"');
		detach();
		channel.close();
	});

	test("publishes one snapshot per tick to every attached page", async () => {
		let reads = 0;
		const status = {
			snapshot: async () => {
				reads += 1;
				return { at: reads, uptimeMs: 0, requests: reads, git: null, changes: null };
			},
		};
		const state = fakeTimer();
		const channel = createLiveChannel({ status, intervalMs: 3000, timer: state.timer });
		const first = client();
		const second = client();
		channel.attach(first);
		channel.attach(second);
		await settle();
		await state.fire();
		expect(reads).toBe(2);
		expect(first.frames.length).toBeGreaterThanOrEqual(2);
		expect(second.frames.length).toBe(first.frames.length);
		channel.close();
	});

	test("stops the ticker with the last page and on close", async () => {
		const state = fakeTimer();
		const channel = createLiveChannel({
			status: { snapshot: async () => ({ at: 0, uptimeMs: 0, requests: 0, git: null, changes: null }) },
			intervalMs: 3000,
			timer: state.timer,
		});
		const first = client();
		const second = client();
		const detachFirst = channel.attach(first);
		const detachSecond = channel.attach(second);
		detachFirst();
		expect(state.stops).toBe(0);
		detachSecond();
		expect(state.stops).toBe(1);
		detachSecond();

		const third = client();
		channel.attach(third);
		channel.close();
		expect(state.stops).toBe(2);
		expect(third.ends).toBe(1);
	});

	test("drops a page whose write fails and stops when none are left", async () => {
		const state = fakeTimer();
		const channel = createLiveChannel({
			status: { snapshot: async () => ({ at: 0, uptimeMs: 0, requests: 0, git: null, changes: null }) },
			intervalMs: 3000,
			timer: state.timer,
		});
		const broken: LiveClient = {
			write: () => {
				throw new Error("socket closed");
			},
			end: () => {},
		};
		channel.attach(broken);
		await state.fire();
		expect(state.stops).toBe(1);
		channel.close();
	});
});
