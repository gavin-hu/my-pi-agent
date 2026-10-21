import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pkg from "../../../package.json";
import { NOTICE_TYPE } from "../../../lib/notice.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { tempDir } from "../../../test/helpers/env.ts";
import { fakeCtx } from "../../../test/helpers/context.ts";
import { makeFakePi } from "../../../test/helpers/fakes.ts";
import { makeTempTracker } from "../../../test/helpers/git.ts";
import { settle } from "../../../test/helpers/process.ts";
import {
	isFresh,
	readUpdateCache,
	UPDATE_CACHE_FILE,
	UPDATE_CACHE_TTL_MS,
	updateCacheKey,
	updateCachePath,
	writeUpdateCache,
	type UpdateCacheEntry,
} from "./cache.ts";
import {
	type FetchLike,
	fetchAvailableUpdates,
	fetchLatestVersion,
	LATEST_VERSION_URL,
	UPDATE_TIMEOUT_MS,
} from "./check.ts";
import { releaseUrl, updateMarker, updateNotice, updateOutcomeText } from "./format.ts";
import { registerUpdate, type UpdateCache } from "./register.ts";
import { createUpdateState, type UpdateSource } from "./state.ts";
import { type PackageManagerPrototype, suppressPiPackageUpdates, type UpdateSuppression } from "./suppress.ts";
import type { PackageUpdate } from "./types.ts";
import { isNewerVersion, parseVersion } from "./version.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

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
const UPDATES: PackageUpdate[] = [
	{ source: "@gavin-hu/my-pi-agent", displayName: "@gavin-hu/my-pi-agent", type: "npm", scope: "user" },
];
const NEWER = "99.0.0";
const NOW = 1_767_225_600_000;
const RELEASE = "https://github.com/gavin-hu/my-pi-agent/releases/tag/v0.14.0";

/** A file in a fresh temp directory, with the parent created. */
function tempFile(contents?: string): string {
	const dir = temps.track(tempDir("bytefly-update-cache-"));
	mkdirSync(dir, { recursive: true });
	const path = join(dir, UPDATE_CACHE_FILE);
	if (contents !== undefined) writeFileSync(path, contents);
	return path;
}

const entry: UpdateCacheEntry = {
	key: "cwd-and-packages",
	checkedAt: NOW,
	updates: UPDATES,
	latest: "0.13.0",
};

describe("updateCachePath and updateCacheKey", () => {
	test("sits under the agent directory's bytefly folder", () => {
		expect(updateCachePath("/agent")).toBe(join("/agent", "bytefly", UPDATE_CACHE_FILE));
	});

	test("is stable for the same cwd and package list", () => {
		expect(updateCacheKey("/repo", ["a", "b"])).toBe(updateCacheKey("/repo", ["a", "b"]));
	});

	test("changes with the cwd or the package list", () => {
		const base = updateCacheKey("/repo", ["a", "b"]);
		expect(updateCacheKey("/other", ["a", "b"])).not.toBe(base);
		expect(updateCacheKey("/repo", ["a", "c"])).not.toBe(base);
	});
});

describe("readUpdateCache", () => {
	test("round-trips what writeUpdateCache wrote", () => {
		const path = tempFile();
		writeUpdateCache(path, entry);
		expect(readUpdateCache(path)).toEqual(entry);
	});

	test("reads an absent file as a miss", () => {
		expect(readUpdateCache(tempFile())).toBeUndefined();
	});

	test("reads corrupt JSON as a miss", () => {
		expect(readUpdateCache(tempFile("{ not json"))).toBeUndefined();
	});

	test("rejects the old one-version schema", () => {
		expect(readUpdateCache(tempFile(JSON.stringify({ latest: "0.13.0", checkedAt: 1 })))).toBeUndefined();
	});

	test("rejects a missing key or timestamp, and a malformed update row", () => {
		for (const payload of [
			{ updates: UPDATES, checkedAt: 1 },
			{ key: "k", updates: UPDATES },
			{ key: "k", updates: [{ displayName: "x" }], checkedAt: 1 },
			{ key: "k", updates: UPDATES, checkedAt: "yesterday" },
			[],
		]) {
			expect(readUpdateCache(tempFile(JSON.stringify(payload))), JSON.stringify(payload)).toBeUndefined();
		}
	});

	test("drops a version that does not parse but keeps the list", () => {
		const path = tempFile(JSON.stringify({ key: "k", updates: UPDATES, checkedAt: 5, latest: "newest" }));
		expect(readUpdateCache(path)).toEqual({ key: "k", updates: UPDATES, checkedAt: 5 });
	});

	test("accepts an empty list", () => {
		const path = tempFile(JSON.stringify({ key: "k", updates: [], checkedAt: 5 }));
		expect(readUpdateCache(path)).toEqual({ key: "k", updates: [], checkedAt: 5 });
	});
});

describe("writeUpdateCache", () => {
	test("creates the directory it needs", () => {
		const dir = temps.track(tempDir("bytefly-update-cache-"));
		const path = updateCachePath(dir);
		writeUpdateCache(path, entry);
		expect(readUpdateCache(path)).toEqual(entry);
	});
});

describe("isFresh", () => {
	test("is false without an entry", () => {
		expect(isFresh(undefined, entry.checkedAt)).toBe(false);
	});

	test("accepts an entry inside the window, including the boundary", () => {
		expect(isFresh(entry, entry.checkedAt)).toBe(true);
		expect(isFresh(entry, entry.checkedAt + 1_000)).toBe(true);
		expect(isFresh(entry, entry.checkedAt + UPDATE_CACHE_TTL_MS)).toBe(true);
	});

	test("rejects an entry past the window, and one from the future", () => {
		expect(isFresh(entry, entry.checkedAt + UPDATE_CACHE_TTL_MS + 1)).toBe(false);
		expect(isFresh(entry, entry.checkedAt - 1)).toBe(false);
	});

	test("honours a caller's window", () => {
		expect(isFresh(entry, entry.checkedAt + 10, 5)).toBe(false);
		expect(isFresh(entry, entry.checkedAt + 10, 10)).toBe(true);
	});
});

/** A fetch seam answering with a fixed status and body. */
function answering(ok: boolean, body: unknown, calls: string[] = []): FetchLike {
	return async (url, init) => {
		calls.push(url);
		expect(init.headers.accept).toBe("application/json");
		return { ok, json: async () => body };
	};
}

describe("fetchAvailableUpdates", () => {
	test("returns Pi's package list through the injected check", async () => {
		let seen: unknown;
		const list = await fetchAvailableUpdates({
			cwd: process.cwd(),
			agentDir: process.cwd(),
			projectTrusted: false,
			checkForAvailableUpdates: async (manager) => {
				seen = manager;
				return UPDATES;
			},
		});

		expect(list).toEqual(UPDATES);
		expect(seen).toBeDefined();
	});

	test("returns undefined when the check throws", async () => {
		const list = await fetchAvailableUpdates({
			cwd: process.cwd(),
			agentDir: process.cwd(),
			projectTrusted: false,
			checkForAvailableUpdates: async () => {
				throw new Error("npm unreachable");
			},
		});

		// Not `[]`: an empty list is a real "everything is current" answer.
		expect(list).toBeUndefined();
	});
});

describe("fetchLatestVersion", () => {
	test("reads the published version from the latest document", async () => {
		const calls: string[] = [];
		expect(await fetchLatestVersion({ fetch: answering(true, { version: "0.12.0" }, calls) })).toBe("0.12.0");
		expect(calls).toEqual([LATEST_VERSION_URL]);
	});

	test("normalises surrounding whitespace", async () => {
		expect(await fetchLatestVersion({ fetch: answering(true, { version: " 0.12.0 " }) })).toBe("0.12.0");
	});

	test("gives up on a non-ok status", async () => {
		expect(await fetchLatestVersion({ fetch: answering(false, { version: "0.12.0" }) })).toBeUndefined();
	});

	test("gives up on a body that is not JSON", async () => {
		const broken: FetchLike = async () => ({
			ok: true,
			json: async () => {
				throw new SyntaxError("Unexpected token < in JSON");
			},
		});
		expect(await fetchLatestVersion({ fetch: broken })).toBeUndefined();
	});

	test("gives up on a payload without a real version", async () => {
		for (const body of [{}, { version: 5 }, { version: "" }, { version: "latest" }, { version: "0.12.x" }, null]) {
			expect(await fetchLatestVersion({ fetch: answering(true, body) }), JSON.stringify(body)).toBeUndefined();
		}
	});

	test("gives up when the request itself fails", async () => {
		const failing: FetchLike = async () => {
			throw new TypeError("fetch failed");
		};
		expect(await fetchLatestVersion({ fetch: failing })).toBeUndefined();
	});

	test("abandons a request that outlives the timeout", async () => {
		const hanging: FetchLike = (_url, init) =>
			new Promise((_resolve, reject) => {
				init.signal.addEventListener("abort", () => reject(new Error("aborted")));
			});
		expect(await fetchLatestVersion({ fetch: hanging, timeoutMs: 5 })).toBeUndefined();
	});

	test("has a bounded default timeout", () => {
		expect(UPDATE_TIMEOUT_MS).toBeGreaterThan(0);
		expect(UPDATE_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
	});
});

describe("updateMarker, updateNotice, and releaseUrl", () => {
	test("the marker is the shared up arrow and the version, with no gap", () => {
		expect(updateMarker("0.14.0")).toBe(`${GLYPHS.update}0.14.0`);
	});

	test("the notice is the shared notice type, shown in the transcript", () => {
		const notice = updateNotice([OWN], "0.12.0", "0.14.0");
		expect(notice.customType).toBe(NOTICE_TYPE);
		expect(notice.display).toBe(true);
	});

	test("the notice tells the model the packages, the version arrow, the command, and the release", () => {
		const notice = updateNotice([OWN, OTHER], "0.12.0", "0.14.0");

		expect(notice.content).toContain("2 package updates available");
		expect(notice.content).toContain("@gavin-hu/my-pi-agent");
		expect(notice.content).toContain("example/tool");
		expect(notice.content).toContain("v0.12.0 → v0.14.0");
		expect(notice.content).toContain("pi update --extensions");
		expect(notice.content).toContain(RELEASE);
	});

	test("the notice is informational, not a fault", () => {
		const notice = updateNotice([OWN], "0.12.0", "0.14.0");
		expect(notice.details.source).toBe("bytefly");
		expect(notice.details.title).toBe("1 package update available");
		expect(notice.details.severity).toBe("info");
	});

	test("the notice carries one row per package, the command, and the release", () => {
		const notice = updateNotice([OWN, OTHER], "0.12.0", "0.14.0");

		expect(notice.details.items).toEqual([
			{ label: "@gavin-hu/my-pi-agent", detail: "v0.12.0 → v0.14.0", severity: "info" },
			{ label: "example/tool", detail: "project", severity: "info" },
			{ label: "update", detail: "pi update --extensions" },
			{ label: "release", detail: RELEASE },
		]);
	});

	test("the notice drops the version and release when this package's version is unknown", () => {
		const notice = updateNotice([OWN, OTHER], "0.12.0");

		expect(notice.details.items).toEqual([
			{ label: "@gavin-hu/my-pi-agent", detail: "global", severity: "info" },
			{ label: "example/tool", detail: "project", severity: "info" },
			{ label: "update", detail: "pi update --extensions" },
		]);
	});

	test("releaseUrl points at the tag page for the version", () => {
		expect(releaseUrl("0.14.0")).toBe(RELEASE);
	});
});

describe("updateOutcomeText", () => {
	test("reports a skip when offline", () => {
		expect(updateOutcomeText({ kind: "offline" }, "0.12.0")).toEqual({
			text: "bytefly: the update check was skipped (PI_OFFLINE is set).",
			severity: "info",
		});
	});

	test("reports an unreadable list as a warning", () => {
		const outcome = updateOutcomeText({ kind: "failed" }, "0.12.0");
		expect(outcome.severity).toBe("warning");
		expect(outcome.text).toContain("could not check package updates");
	});

	test("reports an up-to-date session", () => {
		expect(updateOutcomeText({ kind: "current" }, "0.12.0")).toEqual({
			text: "bytefly: up to date — no configured package has an update.",
			severity: "info",
		});
	});

	test("reports an available package list with this package's version and release", () => {
		const outcome = updateOutcomeText({ kind: "available", updates: [OWN, OTHER], ownLatest: "0.14.0" }, "0.12.0");
		expect(outcome.severity).toBe("info");
		expect(outcome.text).toContain("2 package updates available");
		expect(outcome.text).toContain("@gavin-hu/my-pi-agent");
		expect(outcome.text).toContain("example/tool");
		expect(outcome.text).toContain("v0.12.0 → v0.14.0");
		expect(outcome.text).toContain(RELEASE);
	});

	test("reports another package without inventing this package's version", () => {
		const outcome = updateOutcomeText({ kind: "available", updates: [OTHER] }, "0.12.0");
		expect(outcome.text).not.toContain("This package");
		expect(outcome.text).not.toContain(RELEASE);
		expect(outcome.text).toContain("example/tool");
	});
});

/** An in-memory cache that records what the lifecycle wrote. */
function memoryCache(initial?: UpdateCacheEntry): UpdateCache & { writes: UpdateCacheEntry[] } {
	const writes: UpdateCacheEntry[] = [];
	let current = initial;
	return {
		writes,
		read: () => current,
		write(next) {
			writes.push(next);
			current = next;
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

describe("update cache lifecycle", () => {
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

describe("suppressPiPackageUpdates", () => {
	/** A prototype whose check returns a fixed list. */
	function fakePrototype(): PackageManagerPrototype {
		return { checkForAvailableUpdates: async () => UPDATES };
	}

	test("makes Pi's check report nothing while the captured original still works", async () => {
		const prototype = fakePrototype();
		const suppression = suppressPiPackageUpdates(prototype);
		const manager = {} as never;

		expect(await prototype.checkForAvailableUpdates(manager)).toEqual([]);
		expect(await suppression.check(manager)).toEqual(UPDATES);
	});

	test("restores the original method", async () => {
		const prototype = fakePrototype();
		const original = prototype.checkForAvailableUpdates;
		const suppression = suppressPiPackageUpdates(prototype);
		suppression.restore();

		expect(prototype.checkForAvailableUpdates).toBe(original);
		expect(await prototype.checkForAvailableUpdates({} as never)).toEqual(UPDATES);
	});

	test("is idempotent and does not restore twice over another patch", async () => {
		const prototype = fakePrototype();
		const first = suppressPiPackageUpdates(prototype);
		const second = suppressPiPackageUpdates(prototype);

		expect(second).toBe(first);
		const replacement = async () => [];
		prototype.checkForAvailableUpdates = replacement;
		first.restore();

		expect(prototype.checkForAvailableUpdates).toBe(replacement);
	});

	test("is inert when the host method is missing", async () => {
		const prototype = {} as PackageManagerPrototype;
		const suppression = suppressPiPackageUpdates(prototype);

		expect(await suppression.check({} as never)).toEqual([]);
		expect(() => suppression.restore()).not.toThrow();
	});
});

describe("createUpdateState", () => {
	test("starts with nothing known and records what it is given", () => {
		const state: UpdateSource = createUpdateState();
		expect(state.latest()).toBeUndefined();
		state.set("0.12.0");
		expect(state.latest()).toBe("0.12.0");
	});

	test("clears on an empty set", () => {
		const state = createUpdateState();
		state.set("0.12.0");
		state.set("");
		expect(state.latest()).toBeUndefined();
	});

	test("keeps each store separate, so a reload cannot inherit the last session's value", () => {
		const first = createUpdateState();
		first.set("0.12.0");
		expect(createUpdateState().latest()).toBeUndefined();
	});
});

describe("parseVersion and isNewerVersion", () => {
	test("reads a plain and a partial core, filling the missing segments with 0", () => {
		expect(parseVersion("1.2.3")).toEqual({ core: [1, 2, 3], pre: [] });
		expect(parseVersion("1.2")).toEqual({ core: [1, 2, 0], pre: [] });
		expect(parseVersion("1")).toEqual({ core: [1, 0, 0], pre: [] });
	});

	test("tolerates a leading v and surrounding whitespace", () => {
		expect(parseVersion(" v0.11.4 ")).toEqual({ core: [0, 11, 4], pre: [] });
	});

	test("keeps the prerelease and drops build metadata", () => {
		expect(parseVersion("0.12.0-beta.1+build.5")).toEqual({ core: [0, 12, 0], pre: ["beta", "1"] });
	});

	test("rejects anything that is not a version", () => {
		for (const value of ["", "latest", "*", "1.2.x", "1..2", "1.2.3-", "1.2.3-..", "v", "1.2.3.4", "-1.2.3"]) {
			expect(parseVersion(value), value).toBeUndefined();
		}
	});

	test("orders the core numerically, not lexically", () => {
		expect(isNewerVersion("0.12.0", "0.11.4")).toBe(true);
		expect(isNewerVersion("0.11.10", "0.11.9")).toBe(true);
		expect(isNewerVersion("1.0.0", "0.99.99")).toBe(true);
		expect(isNewerVersion("0.11.4", "0.12.0")).toBe(false);
		expect(isNewerVersion("0.10.0", "0.11.4")).toBe(false);
	});

	test("treats the same version as no upgrade, regardless of notation", () => {
		expect(isNewerVersion("0.11.4", "0.11.4")).toBe(false);
		expect(isNewerVersion("v0.11.4", "0.11.4")).toBe(false);
		expect(isNewerVersion("0.11.4+build.2", "0.11.4")).toBe(false);
	});

	test("ranks a prerelease below its release and above the previous one", () => {
		expect(isNewerVersion("0.12.0", "0.12.0-beta.2")).toBe(true);
		expect(isNewerVersion("0.12.0-beta.2", "0.12.0")).toBe(false);
		expect(isNewerVersion("0.12.0-beta.2", "0.11.4")).toBe(true);
	});

	test("orders prerelease identifiers by semver's rules", () => {
		expect(isNewerVersion("0.12.0-beta.2", "0.12.0-beta.1")).toBe(true);
		expect(isNewerVersion("0.12.0-beta.10", "0.12.0-beta.9")).toBe(true);
		expect(isNewerVersion("0.12.0-beta", "0.12.0-alpha")).toBe(true);
		expect(isNewerVersion("0.12.0-alpha.1", "0.12.0-alpha")).toBe(true);
		expect(isNewerVersion("0.12.0-alpha.beta", "0.12.0-alpha.1")).toBe(true);
		expect(isNewerVersion("0.12.0-rc.1", "0.12.0-beta.11")).toBe(true);
	});

	test("never announces an upgrade from a payload that does not parse", () => {
		expect(isNewerVersion("latest", "0.11.4")).toBe(false);
		expect(isNewerVersion("", "0.11.4")).toBe(false);
		expect(isNewerVersion("0.12.0", "")).toBe(false);
		expect(isNewerVersion("0.12.0", "not-a-version")).toBe(false);
	});
});
