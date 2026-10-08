import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
	isSessionAlive,
	listSessionMarkers,
	pruneSessionMarkers,
	readSessionMarker,
	removeSessionMarker,
	sessionMarkerPath,
	touchSessionMarker,
} from "../../extensions/jobs/session.ts";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "pi-jobs-session-"));
}

describe("sessionMarkerPath", () => {
	test("is stable per session and differs across sessions", () => {
		expect(sessionMarkerPath("/dir", "s1")).toBe(sessionMarkerPath("/dir", "s1"));
		expect(sessionMarkerPath("/dir", "s1")).not.toBe(sessionMarkerPath("/dir", "s2"));
	});

	test("hashes the id so it cannot escape the directory", () => {
		const path = sessionMarkerPath("/dir", "../../evil");
		expect(path.startsWith("/dir/session-")).toBe(true);
		expect(path).not.toContain("..");
	});
});

describe("touch / read / remove", () => {
	test("round-trips through disk", () => {
		const dir = tempDir();
		try {
			touchSessionMarker(dir, "s1", 1234, 500);
			expect(readSessionMarker(dir, "s1")).toEqual({ sessionId: "s1", pid: 1234, updatedAt: 500 });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a missing marker is undefined", () => {
		const dir = tempDir();
		try {
			expect(readSessionMarker(dir, "s1")).toBeUndefined();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a malformed marker is undefined", () => {
		const dir = tempDir();
		try {
			writeFileSync(sessionMarkerPath(dir, "s1"), JSON.stringify({ sessionId: "s1", pid: "x" }), "utf-8");
			expect(readSessionMarker(dir, "s1")).toBeUndefined();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("remove deletes the marker and tolerates a missing one", () => {
		const dir = tempDir();
		try {
			touchSessionMarker(dir, "s1", 1, 1);
			removeSessionMarker(dir, "s1");
			expect(readSessionMarker(dir, "s1")).toBeUndefined();
			expect(() => removeSessionMarker(dir, "s1")).not.toThrow();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("isSessionAlive", () => {
	const alive = () => true;

	test("a missing marker is dead", () => {
		expect(isSessionAlive(undefined, 1000, 100, alive)).toBe(false);
	});

	test("a dead pid is dead even when fresh", () => {
		expect(isSessionAlive({ sessionId: "s1", pid: 42, updatedAt: 1000 }, 1000, 100, () => false)).toBe(false);
	});

	test("a stale heartbeat is dead", () => {
		expect(isSessionAlive({ sessionId: "s1", pid: 42, updatedAt: 800 }, 1000, 100, alive)).toBe(false);
	});

	test("a fresh heartbeat with a live pid is alive", () => {
		expect(isSessionAlive({ sessionId: "s1", pid: 42, updatedAt: 950 }, 1000, 100, alive)).toBe(true);
	});

	test("a non-positive pid falls back to the timestamp", () => {
		expect(isSessionAlive({ sessionId: "s1", pid: 0, updatedAt: 950 }, 1000, 100, () => false)).toBe(true);
	});
});

describe("list / prune", () => {
	test("lists every valid marker", () => {
		const dir = tempDir();
		try {
			touchSessionMarker(dir, "s1", 1, 100);
			touchSessionMarker(dir, "s2", 2, 100);
			expect(
				listSessionMarkers(dir)
					.map((m) => m.sessionId)
					.sort(),
			).toEqual(["s1", "s2"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("prunes dead and stale markers, keeping live ones", () => {
		const dir = tempDir();
		try {
			touchSessionMarker(dir, "live", 10, 1000);
			touchSessionMarker(dir, "deadpid", 20, 1000);
			touchSessionMarker(dir, "stale", 30, 100);
			pruneSessionMarkers(dir, 1000, 100, (pid) => pid !== 20);
			expect(listSessionMarkers(dir).map((m) => m.sessionId)).toEqual(["live"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
