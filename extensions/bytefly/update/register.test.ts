import { describe, expect, test } from "bun:test";
import pkg from "../../../package.json";
import { NOTICE_TYPE } from "../../../lib/notice.ts";
import { fakeCtx } from "../../../test/helpers/context.ts";
import { makeFakePi } from "../../../test/helpers/fakes.ts";
import { settle } from "../../../test/helpers/process.ts";
import { UPDATE_CACHE_TTL_MS, type UpdateCacheEntry } from "./cache.ts";
import { registerUpdate, type UpdateCache } from "./register.ts";
import { createUpdateState } from "./state.ts";

/** A version guaranteed to be newer than the one under test. */
const NEWER = "99.0.0";

/** A fixed clock, so a cache timestamp is asserted and never read from the wall. */
const NOW = 1_767_225_600_000;

/** An in-memory cache that records what the lifecycle wrote. */
function memoryCache(initial?: UpdateCacheEntry): UpdateCache & { writes: UpdateCacheEntry[] } {
	const writes: UpdateCacheEntry[] = [];
	let entry = initial;
	return {
		writes,
		read: () => entry,
		write(next) {
			writes.push(next);
			entry = next;
		},
	};
}

/** Boot the update surface over a fixed registry answer. */
function boot(
	reply: string | undefined,
	options: {
		offline?: boolean;
		mode?: string;
		fail?: boolean;
		cache?: UpdateCache;
	} = {},
) {
	const { pi, customMessages } = makeFakePi();
	const { ctx } = fakeCtx({ mode: options.mode ?? "tui" });
	const state = createUpdateState();
	const cache = (options.cache ?? memoryCache()) as ReturnType<typeof memoryCache>;
	const reads: number[] = [];
	const updates: number[] = [];
	const handle = registerUpdate(pi, state, {
		fetchLatest: async () => {
			reads.push(1);
			if (options.fail) throw new Error("registry unreachable");
			return reply;
		},
		isOffline: () => options.offline ?? false,
		cache,
		now: () => NOW,
		onUpdate: () => updates.push(1),
	});
	const start = async (): Promise<void> => {
		for (const handler of pi.handlers.get("session_start") ?? []) await handler({}, ctx);
		await settle();
	};
	const shutdown = async (): Promise<void> => {
		for (const handler of pi.handlers.get("session_shutdown") ?? []) await handler({}, ctx);
		await settle();
	};
	return { pi, state, cache, customMessages, reads, updates, handle, start, shutdown };
}

/** The notice the surface posted, when there is exactly one. */
function noticeOf(customMessages: unknown[]): { customType: string; content: string; details: any } {
	expect(customMessages).toHaveLength(1);
	return (customMessages[0] as { message: any }).message;
}

describe("update check", () => {
	test("marks the store and posts one notice when a newer version is published", async () => {
		const { state, customMessages, updates, start } = boot(NEWER);
		await start();

		expect(state.latest()).toBe(NEWER);
		expect(updates).toHaveLength(1);
		const message = noticeOf(customMessages);
		expect(message.customType).toBe(NOTICE_TYPE);
		expect(message.details.source).toBe("bytefly");
		expect(message.details.title).toBe(`${NEWER} is available`);
		expect(message.content).toContain(`current ${pkg.version}`);
	});

	test("stays quiet when the loaded version is current", async () => {
		const { state, customMessages, updates, start } = boot(pkg.version);
		await start();

		expect(state.latest()).toBeUndefined();
		expect(updates).toEqual([]);
		expect(customMessages).toEqual([]);
	});

	test("stays quiet when the registry is behind", async () => {
		const { state, customMessages, start } = boot("0.0.1");
		await start();

		expect(state.latest()).toBeUndefined();
		expect(customMessages).toEqual([]);
	});

	test("stays quiet when the read fails or returns nothing", async () => {
		for (const options of [{ fail: true }, {}]) {
			const { state, customMessages, start } = boot(undefined, options);
			await start();
			expect(state.latest()).toBeUndefined();
			expect(customMessages).toEqual([]);
		}
	});

	test("makes no request when offline", async () => {
		const { reads, customMessages, start } = boot(NEWER, { offline: true });
		await start();

		expect(reads).toEqual([]);
		expect(customMessages).toEqual([]);
	});

	test("makes no request outside the interactive mode", async () => {
		const { reads, customMessages, start } = boot(NEWER, { mode: "print" });
		await start();

		expect(reads).toEqual([]);
		expect(customMessages).toEqual([]);
	});

	test("announces once per load, even if the session starts again", async () => {
		const { customMessages, reads, start } = boot(NEWER);
		await start();
		await start();

		expect(reads).toHaveLength(1);
		expect(customMessages).toHaveLength(1);
	});

	test("drops the recorded version on shutdown", async () => {
		const { state, start, shutdown } = boot(NEWER);
		await start();
		await shutdown();

		expect(state.latest()).toBeUndefined();
	});

	test("ignores a reply that lands after shutdown", async () => {
		const { pi, customMessages } = makeFakePi();
		const { ctx } = fakeCtx({ mode: "tui" });
		const state = createUpdateState();
		let answer: (value: string | undefined) => void = () => {};
		registerUpdate(pi, state, {
			fetchLatest: () =>
				new Promise<string | undefined>((resolve) => {
					answer = resolve;
				}),
			isOffline: () => false,
			cache: memoryCache(),
			now: () => NOW,
		});
		for (const handler of pi.handlers.get("session_start") ?? []) await handler({}, ctx);
		for (const handler of pi.handlers.get("session_shutdown") ?? []) await handler({}, ctx);
		answer(NEWER);
		await settle();

		expect(state.latest()).toBeUndefined();
		expect(customMessages).toEqual([]);
	});
});

describe("update cache", () => {
	test("records the answer it read, with the time it read it", async () => {
		const { cache, start } = boot(NEWER);
		await start();

		expect(cache.writes).toEqual([{ latest: NEWER, checkedAt: NOW }]);
	});

	test("writes nothing when the read fails", async () => {
		for (const options of [{ fail: true }, {}]) {
			const { cache, start } = boot(undefined, options);
			await start();
			expect(cache.writes).toEqual([]);
		}
	});

	test("reuses a fresh entry instead of making a request", async () => {
		const cache = memoryCache({ latest: NEWER, checkedAt: NOW - 1_000 });
		const { state, customMessages, reads, start } = boot(NEWER, { cache });
		await start();

		expect(reads).toEqual([]);
		expect(cache.writes).toEqual([]);
		expect(state.latest()).toBe(NEWER);
		expect(noticeOf(customMessages).details.title).toBe(`${NEWER} is available`);
	});

	test("re-reads once the entry is past the window", async () => {
		const cache = memoryCache({ latest: "0.0.1", checkedAt: NOW - UPDATE_CACHE_TTL_MS - 1 });
		const { state, reads, start } = boot(NEWER, { cache });
		await start();

		expect(reads).toHaveLength(1);
		expect(cache.writes).toEqual([{ latest: NEWER, checkedAt: NOW }]);
		expect(state.latest()).toBe(NEWER);
	});

	test("applies a cached entry when offline, without a request or a write", async () => {
		const cache = memoryCache({ latest: NEWER, checkedAt: NOW - UPDATE_CACHE_TTL_MS * 2 });
		const { state, reads, start } = boot(NEWER, { cache, offline: true });
		await start();

		expect(reads).toEqual([]);
		expect(cache.writes).toEqual([]);
		expect(state.latest()).toBe(NEWER);
	});
});

describe("recheck", () => {
	test("reads the registry even when the cache is fresh", async () => {
		const cache = memoryCache({ latest: "0.0.1", checkedAt: NOW });
		const { handle, state, reads } = boot(NEWER, { cache });

		expect(await handle.recheck()).toEqual({ kind: "available", latest: NEWER });
		expect(reads).toHaveLength(1);
		expect(cache.writes).toEqual([{ latest: NEWER, checkedAt: NOW }]);
		expect(state.latest()).toBe(NEWER);
	});

	test("reports the newest version when nothing is newer", async () => {
		const { handle } = boot(pkg.version);

		expect(await handle.recheck()).toEqual({ kind: "current", latest: pkg.version });
	});

	test("reports an unreadable registry", async () => {
		for (const options of [{ fail: true }, {}]) {
			const { handle, cache } = boot(undefined, options);
			expect(await handle.recheck()).toEqual({ kind: "failed" });
			expect(cache.writes).toEqual([]);
		}
	});

	test("reports a skip when offline, without a request", async () => {
		const { handle, reads } = boot(NEWER, { offline: true });

		expect(await handle.recheck()).toEqual({ kind: "offline" });
		expect(reads).toEqual([]);
	});

	test("never posts a notice; the caller reports", async () => {
		const { handle, customMessages } = boot(NEWER);

		await handle.recheck();

		expect(customMessages).toEqual([]);
	});

	test("paints the marker an explicit check finds", async () => {
		const { handle, updates } = boot(NEWER);

		await handle.recheck();

		expect(updates).toHaveLength(1);
	});
});
