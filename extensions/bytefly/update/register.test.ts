import { describe, expect, test } from "bun:test";
import pkg from "../../../package.json";
import { NOTICE_TYPE } from "../../../lib/notice.ts";
import { fakeCtx } from "../../../test/helpers/context.ts";
import { makeFakePi } from "../../../test/helpers/fakes.ts";
import { settle } from "../../../test/helpers/process.ts";
import { UPDATE_CACHE_TTL_MS, updateCacheKey, type UpdateCacheEntry } from "./cache.ts";
import { registerUpdate, type UpdateCache } from "./register.ts";
import { createUpdateState } from "./state.ts";
import type { UpdateSuppression } from "./suppress.ts";
import type { PackageUpdate } from "./types.ts";

/** A version guaranteed to be newer than the one under test. */
const NEWER = "99.0.0";
/** A fixed clock, so a cache timestamp is asserted and never read from the wall. */
const NOW = 1_767_225_600_000;
const OWN: PackageUpdate = {
	source: "@gavin-hu/my-pi-agent",
	displayName: pkg.name,
	type: "npm",
	scope: "user",
};
const OTHER: PackageUpdate = {
	source: "github.com/example/tool",
	displayName: "example/tool",
	type: "git",
	scope: "project",
};

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

interface BootOptions {
	updates?: PackageUpdate[];
	latest?: string;
	latestFails?: boolean;
	subscriptionFails?: boolean;
	/** The package-manager read answers "cannot run" (undefined), not "nothing to update". */
	listUnavailable?: boolean;
	offline?: boolean;
	mode?: string;
	cache?: ReturnType<typeof memoryCache>;
	packages?: string[];
}

/** Boot the update surface over a fixed package list and version answer. */
function boot(options: BootOptions = {}) {
	const { pi, customMessages } = makeFakePi({ settings: { packages: options.packages ?? [] } });
	const { ctx } = fakeCtx({ mode: options.mode ?? "tui" });
	const state = createUpdateState();
	const cache = options.cache ?? memoryCache();
	const reads: number[] = [];
	const latestReads: number[] = [];
	const updates: number[] = [];
	const restores: number[] = [];
	const suppression: UpdateSuppression = {
		check: async () => options.updates ?? [],
		restore: () => restores.push(1),
	};
	let suppressCalls = 0;
	const handle = registerUpdate(pi, state, {
		suppress: () => {
			suppressCalls++;
			return suppression;
		},
		readUpdates: async () => {
			reads.push(1);
			if (options.subscriptionFails) throw new Error("package manager unavailable");
			if (options.listUnavailable) return undefined;
			return options.updates ?? [];
		},
		fetchLatest: async () => {
			latestReads.push(1);
			if (options.latestFails) throw new Error("registry unreachable");
			return options.latest;
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
	return {
		pi,
		ctx,
		state,
		cache,
		customMessages,
		reads,
		latestReads,
		updates,
		restores,
		suppression,
		suppressCalls: () => suppressCalls,
		handle,
		start,
		shutdown,
	};
}

/** The notice the surface posted, when there is exactly one. */
function noticeOf(customMessages: unknown[]): { customType: string; content: string; details: any } {
	expect(customMessages).toHaveLength(1);
	return (customMessages[0] as { message: any }).message;
}

/** The cache key the default test context produces. */
function keyFor(ctx: { cwd: string }, packages: string[] = []): string {
	return updateCacheKey(ctx.cwd, packages);
}

describe("update check", () => {
	test("marks this package and posts one notice from Pi's list", async () => {
		const booted = boot({ updates: [OWN, OTHER], latest: NEWER });
		await booted.start();

		expect(booted.state.latest()).toBe(NEWER);
		expect(booted.latestReads).toHaveLength(1);
		expect(booted.updates).toHaveLength(1);
		const message = noticeOf(booted.customMessages);
		expect(message.customType).toBe(NOTICE_TYPE);
		expect(message.details.source).toBe("bytefly");
		expect(message.details.title).toBe("2 package updates available");
		expect(message.content).toContain("example/tool");
		expect(message.content).toContain(`v${pkg.version} → v99.0.0`);
		expect(message.content).toContain("releases/tag/v99.0.0");
	});

	test("does not put another package's update on the header", async () => {
		const booted = boot({ updates: [OTHER] });
		await booted.start();

		expect(booted.state.latest()).toBeUndefined();
		expect(booted.latestReads).toEqual([]);
		expect(noticeOf(booted.customMessages).details.title).toBe("1 package update available");
	});

	test("stays quiet when Pi reports no updates", async () => {
		const booted = boot({ updates: [] });
		await booted.start();

		expect(booted.state.latest()).toBeUndefined();
		expect(booted.updates).toEqual([]);
		expect(booted.customMessages).toEqual([]);
	});

	test("keeps the list when the version read fails, without inventing a marker", async () => {
		const booted = boot({ updates: [OWN], latestFails: true });
		await booted.start();

		expect(booted.state.latest()).toBeUndefined();
		const message = noticeOf(booted.customMessages);
		expect(message.details.items[0]).toEqual({ label: pkg.name, detail: "global", severity: "info" });
		expect(message.content).not.toContain("releases/tag");
	});

	test("does not paint an equal or older version", async () => {
		const booted = boot({ updates: [OWN], latest: "0.0.1" });
		await booted.start();

		expect(booted.state.latest()).toBeUndefined();
		expect(noticeOf(booted.customMessages).content).not.toContain("releases/tag");
	});

	test("stays quiet when the list read fails", async () => {
		const booted = boot({ updates: [OWN], latest: NEWER, subscriptionFails: true });
		await booted.start();

		expect(booted.state.latest()).toBeUndefined();
		expect(booted.cache.writes).toEqual([]);
		expect(booted.customMessages).toEqual([]);
	});

	test("leaves the marker and the cache alone when the check cannot run", async () => {
		const booted = boot({ updates: [OWN], latest: NEWER, listUnavailable: true });
		await booted.start();

		expect(booted.reads).toHaveLength(1);
		expect(booted.cache.writes).toEqual([]);
		expect(booted.state.latest()).toBeUndefined();
		expect(booted.customMessages).toEqual([]);
	});

	test("makes no request outside the interactive mode, but still answers recheck", async () => {
		const booted = boot({ updates: [OWN], latest: NEWER, mode: "print" });
		await booted.start();

		expect(booted.reads).toEqual([]);
		expect(booted.customMessages).toEqual([]);
		expect(booted.suppressCalls()).toBe(0);

		expect(await booted.handle.recheck()).toEqual({ kind: "available", updates: [OWN], ownLatest: NEWER });
	});

	test("announces once per load, even if the session starts again", async () => {
		const booted = boot({ updates: [OWN], latest: NEWER });
		await booted.start();
		await booted.start();

		expect(booted.reads).toHaveLength(1);
		expect(booted.customMessages).toHaveLength(1);
	});

	test("clears the store and restores Pi's check on shutdown", async () => {
		const booted = boot({ updates: [OWN], latest: NEWER });
		await booted.start();
		await booted.shutdown();

		expect(booted.state.latest()).toBeUndefined();
		expect(booted.restores).toEqual([1]);
	});

	test("ignores a reply that lands after shutdown", async () => {
		const { pi, customMessages } = makeFakePi({ settings: { packages: [] } });
		const { ctx } = fakeCtx({ mode: "tui" });
		const state = createUpdateState();
		let answer: (value: PackageUpdate[]) => void = () => {};
		const suppression: UpdateSuppression = { check: async () => [], restore: () => {} };
		registerUpdate(pi, state, {
			suppress: () => suppression,
			readUpdates: () =>
				new Promise<PackageUpdate[]>((resolve) => {
					answer = resolve;
				}),
			cache: memoryCache(),
			now: () => NOW,
		});
		for (const handler of pi.handlers.get("session_start") ?? []) await handler({}, ctx);
		for (const handler of pi.handlers.get("session_shutdown") ?? []) await handler({}, ctx);
		answer([OWN]);
		await settle();

		expect(state.latest()).toBeUndefined();
		expect(customMessages).toEqual([]);
	});
});

describe("update cache", () => {
	test("records the snapshot it read, with the time and settings key it read it under", async () => {
		const booted = boot({ updates: [OWN], latest: NEWER });
		await booted.start();

		expect(booted.cache.writes).toEqual([{ key: keyFor(booted.ctx), checkedAt: NOW, updates: [OWN], latest: NEWER }]);
	});

	test("writes nothing when the list read fails", async () => {
		const booted = boot({ updates: [OWN], subscriptionFails: true });
		await booted.start();
		expect(booted.cache.writes).toEqual([]);
	});

	test("reuses a fresh matching snapshot instead of making a request", async () => {
		const cache = memoryCache();
		const key = updateCacheKey(process.cwd(), []);
		cache.write({ key, checkedAt: NOW - 1_000, updates: [OWN], latest: NEWER });
		cache.writes.length = 0;
		const booted = boot({ updates: [OWN], latest: NEWER, cache });
		await booted.start();

		expect(booted.reads).toEqual([]);
		expect(booted.latestReads).toEqual([]);
		expect(booted.cache.writes).toEqual([]);
		expect(booted.state.latest()).toBe(NEWER);
		expect(noticeOf(booted.customMessages).details.title).toBe("1 package update available");
	});

	test("re-reads when the snapshot belongs to another cwd or package list", async () => {
		const cache = memoryCache({ key: "another-project", checkedAt: NOW, updates: [OWN], latest: NEWER });
		const booted = boot({ updates: [OWN], latest: NEWER, cache });
		await booted.start();

		expect(booted.reads).toHaveLength(1);
		expect(booted.cache.writes[0]?.key).toBe(keyFor(booted.ctx));
	});

	test("re-reads once the snapshot is past the window", async () => {
		const cache = memoryCache({
			key: updateCacheKey(process.cwd(), []),
			checkedAt: NOW - UPDATE_CACHE_TTL_MS - 1,
			updates: [OTHER],
		});
		const booted = boot({ updates: [OWN], latest: NEWER, cache });
		await booted.start();

		expect(booted.reads).toHaveLength(1);
		expect(booted.cache.writes[0]?.updates).toEqual([OWN]);
	});

	test("applies a cached marker when offline, without a request, a notice, or a write", async () => {
		const cache = memoryCache();
		const key = updateCacheKey(process.cwd(), []);
		cache.write({ key, checkedAt: NOW - UPDATE_CACHE_TTL_MS * 2, updates: [OWN], latest: NEWER });
		cache.writes.length = 0;
		const booted = boot({ offline: true, cache });
		await booted.start();

		expect(booted.reads).toEqual([]);
		expect(booted.latestReads).toEqual([]);
		expect(booted.cache.writes).toEqual([]);
		expect(booted.state.latest()).toBe(NEWER);
		expect(booted.customMessages).toEqual([]);
	});
});

describe("recheck", () => {
	test("reads the list even when the cache is fresh", async () => {
		const cache = memoryCache({ key: "stale", checkedAt: NOW, updates: [] });
		const booted = boot({ updates: [OWN], latest: NEWER, cache });
		await booted.start();

		expect(await booted.handle.recheck()).toEqual({ kind: "available", updates: [OWN], ownLatest: NEWER });
		expect(booted.reads).toHaveLength(2);
		expect(booted.cache.writes).toHaveLength(2);
		expect(booted.state.latest()).toBe(NEWER);
	});

	test("reports other packages without inventing this package's version", async () => {
		const booted = boot({ updates: [OTHER] });
		await booted.start();

		expect(await booted.handle.recheck()).toEqual({ kind: "available", updates: [OTHER] });
	});

	test("reports an up-to-date session and leaves the marker clear", async () => {
		const booted = boot({ updates: [] });
		await booted.start();

		expect(await booted.handle.recheck()).toEqual({ kind: "current" });
		expect(booted.state.latest()).toBeUndefined();
	});

	test("reports a check that could not run as failed, not up to date", async () => {
		const booted = boot({ updates: [OWN], listUnavailable: true });
		await booted.start();

		expect(await booted.handle.recheck()).toEqual({ kind: "failed" });
		expect(booted.cache.writes).toEqual([]);
	});

	test("reports an unreadable package manager", async () => {
		const booted = boot({ updates: [OWN], subscriptionFails: true });
		await booted.start();

		expect(await booted.handle.recheck()).toEqual({ kind: "failed" });
		expect(booted.cache.writes).toEqual([]);
	});

	test("reports a skip when offline, without a request", async () => {
		const booted = boot({ updates: [OWN], offline: true });
		await booted.start();

		expect(await booted.handle.recheck()).toEqual({ kind: "offline" });
		expect(booted.reads).toEqual([]);
	});

	test("never posts a notice; the caller reports", async () => {
		const booted = boot({ updates: [OWN], latest: NEWER });
		await booted.start();
		const noticesAfterStart = booted.customMessages.length;

		await booted.handle.recheck();

		expect(booted.customMessages).toHaveLength(noticesAfterStart);
	});
});
