import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { tempDir } from "../../test/helpers/env.ts";
import { acquireLock, isLocked, releaseLock, type LockDeps } from "./lock.ts";

function newPath(): string {
	return join(tempDir("wechat-lock-"), "poller.lock");
}

function deps(overrides: Partial<LockDeps> = {}): LockDeps {
	return { now: () => 1000, pid: 1, isAlive: () => true, staleMs: 100, ...overrides };
}

describe("poller lock", () => {
	test("acquires when no lock exists", () => {
		const path = newPath();
		expect(acquireLock(path, deps())).toBe(true);
		expect(isLocked(path, deps({ pid: 2 }))).toBe(true);
	});

	test("does not block the same pid", () => {
		const path = newPath();
		acquireLock(path, deps());
		expect(isLocked(path, deps())).toBe(false);
	});

	test("does not block when the holder pid is dead", () => {
		const path = newPath();
		acquireLock(path, deps());
		expect(isLocked(path, deps({ pid: 2, isAlive: () => false }))).toBe(false);
	});

	test("does not block a stale lock", () => {
		const path = newPath();
		acquireLock(path, deps());
		expect(isLocked(path, deps({ pid: 2, now: () => 5000 }))).toBe(false);
	});

	test("takes over a stale lock", () => {
		const path = newPath();
		acquireLock(path, deps());
		expect(acquireLock(path, deps({ pid: 2, now: () => 5000 }))).toBe(true);
	});

	test("release by a different pid leaves the lock", () => {
		const path = newPath();
		acquireLock(path, deps());
		releaseLock(path, 2);
		expect(isLocked(path, deps({ pid: 2 }))).toBe(true);
	});

	test("release by the owner removes the lock", () => {
		const path = newPath();
		acquireLock(path, deps());
		releaseLock(path, 1);
		expect(isLocked(path, deps({ pid: 2 }))).toBe(false);
	});
});
