import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { commitTree, listRefs, revParse, updateRef } from "../../extensions/git/rewind/git.ts";
import { createSnapshot, type SnapshotInput } from "../../extensions/git/rewind/snapshot.ts";
import {
	clearSnapshots,
	deleteSnapshots,
	encodeMessage,
	getSnapshot,
	idFromRef,
	listSnapshots,
	parseMessage,
	pruneSnapshots,
	refFor,
	type SnapshotMeta,
} from "../../extensions/git/rewind/store.ts";
import { cleanup, indexFileFor, makeRepo, runGit } from "./helpers.ts";

const cleanups: string[] = [];
afterAll(() => cleanup(...cleanups));

const NS = "refs/pi/rewind";

function input(root: string, overrides: Partial<SnapshotInput> = {}): SnapshotInput {
	return {
		root,
		indexFile: indexFileFor(root),
		namespace: NS,
		reason: "manual",
		includeUntracked: true,
		sessionId: "session-1",
		entryId: null,
		...overrides,
	};
}

function meta(overrides: Partial<SnapshotMeta> = {}): SnapshotMeta {
	return {
		v: 3,
		id: "x",
		reason: "manual",
		timestamp: 1000,
		root: "/repo",
		head: "h",
		clean: true,
		includeUntracked: true,
		sessionId: "session-1",
		entryId: null,
		...overrides,
	};
}

describe("metadata encoding", () => {
	test("refFor and idFromRef round-trip", () => {
		expect(refFor(NS, "abc")).toBe(`${NS}/abc`);
		expect(idFromRef(NS, `${NS}/abc`)).toBe("abc");
		expect(idFromRef(NS, "refs/heads/main")).toBeUndefined();
	});

	test("encode/parse round-trip keeps the conversation anchor", () => {
		const parsed = parseMessage(encodeMessage(meta({ label: "prep", prompt: "fix the list", entryId: "e1" })));
		expect(parsed?.id).toBe("x");
		expect(parsed?.label).toBe("prep");
		expect(parsed?.prompt).toBe("fix the list");
		expect(parsed?.sessionId).toBe("session-1");
		expect(parsed?.entryId).toBe("e1");
	});

	test("keeps braces in a label from breaking the JSON scan", () => {
		const parsed = parseMessage(encodeMessage(meta({ label: "a } b" })));
		expect(parsed?.label).toBe("a } b");
	});

	test("rejects a missing, malformed, or incomplete line", () => {
		expect(parseMessage("snapshot x\n\nno metadata here")).toBeUndefined();
		expect(parseMessage("pi-rewind: { not json")).toBeUndefined();
		expect(parseMessage(`pi-rewind: ${JSON.stringify({ id: "x" })}`)).toBeUndefined();
		expect(parseMessage(`pi-rewind: ${JSON.stringify(meta({ reason: "bogus" as never }))}`)).toBeUndefined();
		expect(parseMessage(`pi-rewind: ${JSON.stringify(meta({ prompt: 5 as never }))}`)).toBeUndefined();
		expect(parseMessage(`pi-rewind: ${JSON.stringify(meta({ sessionId: 5 as never }))}`)).toBeUndefined();
	});

	test("rejects older schema versions (v1 and v2)", () => {
		const { v: _v, ...v1 } = meta();
		expect(parseMessage(`pi-rewind: ${JSON.stringify(v1)}`)).toBeUndefined();
		expect(parseMessage(`pi-rewind: ${JSON.stringify(meta({ v: 2 }))}`)).toBeUndefined();
	});
});

describe("ref-backed storage", () => {
	let repo: string;

	beforeAll(async () => {
		repo = await makeRepo("pi-rw-store-");
		cleanups.push(repo);
	});

	test("lists newest first, resolves last, and filters by root", async () => {
		await createSnapshot({ runGit, now: () => 1000, idFactory: () => "a" }, input(repo));
		await createSnapshot({ runGit, now: () => 2000, idFactory: () => "b" }, input(repo));
		// Craft a valid snapshot that records a different root, to exercise the filter.
		const head = (await revParse(runGit, repo, "HEAD")) as string;
		const tree = (await revParse(runGit, repo, "HEAD^{tree}")) as string;
		const foreign = await commitTree(
			runGit,
			repo,
			tree,
			head,
			encodeMessage(meta({ id: "foreign", root: "/elsewhere", head, timestamp: 3000 })),
		);
		await updateRef(runGit, repo, refFor(NS, "foreign"), foreign);

		const all = await listSnapshots(runGit, repo, NS);
		expect(all.map((snapshot) => snapshot.id)).toEqual(["foreign", "b", "a"]);

		const last = await getSnapshot(runGit, repo, NS, "last");
		expect(last?.id).toBe("foreign");
		const byId = await getSnapshot(runGit, repo, NS, "a");
		expect(byId?.id).toBe("a");

		const scoped = await listSnapshots(runGit, repo, NS, { root: repo });
		expect(scoped.map((snapshot) => snapshot.id)).toEqual(["b", "a"]);
		const scopedLast = await getSnapshot(runGit, repo, NS, "last", { root: repo });
		expect(scopedLast?.id).toBe("b");
	});

	test("prunes the oldest beyond max for a root", async () => {
		const fresh = await makeRepo("pi-rw-prune-");
		cleanups.push(fresh);
		for (const [time, id] of [
			[1000, "p1"],
			[2000, "p2"],
			[3000, "p3"],
		] as const) {
			await createSnapshot({ runGit, now: () => time, idFactory: () => id }, input(fresh));
		}
		const removed = await pruneSnapshots(runGit, fresh, NS, 2, fresh);
		expect(removed).toBe(1);
		const remaining = await listSnapshots(runGit, fresh, NS, { root: fresh });
		expect(remaining.map((snapshot) => snapshot.id)).toEqual(["p3", "p2"]);
	});

	test("deleteSnapshots removes refs", async () => {
		const snapshots = await listSnapshots(runGit, repo, NS);
		const removed = await deleteSnapshots(runGit, repo, snapshots);
		expect(removed).toBeGreaterThan(0);
		expect(await listSnapshots(runGit, repo, NS)).toEqual([]);
	});

	test("clearSnapshots sweeps orphans but keeps other roots", async () => {
		const fresh = await makeRepo("pi-rw-clear-");
		cleanups.push(fresh);
		await createSnapshot({ runGit, now: () => 1000, idFactory: () => "mine" }, input(fresh));

		const head = (await revParse(runGit, fresh, "HEAD")) as string;
		const tree = (await revParse(runGit, fresh, "HEAD^{tree}")) as string;
		const foreign = await commitTree(
			runGit,
			fresh,
			tree,
			head,
			encodeMessage(meta({ id: "foreign2", root: "/elsewhere", head, timestamp: 2000 })),
		);
		await updateRef(runGit, fresh, refFor(NS, "foreign2"), foreign);

		// A legacy ref has no `v`, so the list skips it but clear sweeps it.
		const { v: _v, ...legacy } = meta({ id: "legacy", root: fresh, head, timestamp: 500 });
		const orphan = await commitTree(runGit, fresh, tree, head, encodeMessage(legacy as SnapshotMeta));
		await updateRef(runGit, fresh, refFor(NS, "legacy"), orphan);

		expect(await clearSnapshots(runGit, fresh, NS, { root: fresh })).toBe(2);
		expect([...(await listRefs(runGit, fresh, NS)).keys()]).toEqual([refFor(NS, "foreign2")]);

		expect(await clearSnapshots(runGit, fresh, NS)).toBe(1);
		expect((await listRefs(runGit, fresh, NS)).size).toBe(0);
	});
});
