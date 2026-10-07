import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { commitTree, revParse, updateRef } from "../../extensions/checkpoint/git.ts";
import { createCheckpoint } from "../../extensions/checkpoint/snapshot.ts";
import {
	deleteCheckpoints,
	encodeMessage,
	getCheckpoint,
	idFromRef,
	listCheckpoints,
	parseMessage,
	pruneCheckpoints,
	refFor,
	type CheckpointMeta,
} from "../../extensions/checkpoint/store.ts";
import { cleanup, indexFileFor, makeRepo, runGit } from "./helpers.ts";

const cleanups: string[] = [];
afterAll(() => cleanup(...cleanups));

const NS = "refs/pi/checkpoints";

function meta(overrides: Partial<CheckpointMeta> = {}): CheckpointMeta {
	return {
		id: "x",
		tree: "t",
		reason: "manual",
		timestamp: 1000,
		root: "/repo",
		head: "h",
		clean: true,
		includeUntracked: true,
		...overrides,
	};
}

describe("metadata encoding", () => {
	test("refFor and idFromRef round-trip", () => {
		expect(refFor(NS, "abc")).toBe(`${NS}/abc`);
		expect(idFromRef(NS, `${NS}/abc`)).toBe("abc");
		expect(idFromRef(NS, "refs/heads/main")).toBeUndefined();
	});

	test("encode/parse round-trip", () => {
		const parsed = parseMessage(encodeMessage(meta({ label: "prep" })));
		expect(parsed?.id).toBe("x");
		expect(parsed?.label).toBe("prep");
	});

	test("keeps braces in a label from breaking the JSON scan", () => {
		const parsed = parseMessage(encodeMessage(meta({ label: "a } b" })));
		expect(parsed?.label).toBe("a } b");
	});

	test("rejects a missing, malformed, or incomplete line", () => {
		expect(parseMessage("checkpoint x\n\nno metadata here")).toBeUndefined();
		expect(parseMessage("pi-checkpoint: { not json")).toBeUndefined();
		expect(parseMessage(`pi-checkpoint: ${JSON.stringify({ id: "x" })}`)).toBeUndefined();
		expect(parseMessage(`pi-checkpoint: ${JSON.stringify(meta({ reason: "bogus" as never }))}`)).toBeUndefined();
	});
});

describe("ref-backed storage", () => {
	let repo: string;

	beforeAll(async () => {
		repo = await makeRepo("pi-cp-store-");
		cleanups.push(repo);
	});

	test("lists newest first, resolves last, and filters by root", async () => {
		await createCheckpoint(
			{ runGit, now: () => 1000, idFactory: () => "a" },
			{ root: repo, indexFile: indexFileFor(repo), namespace: NS, reason: "manual", includeUntracked: true },
		);
		await createCheckpoint(
			{ runGit, now: () => 2000, idFactory: () => "b" },
			{ root: repo, indexFile: indexFileFor(repo), namespace: NS, reason: "manual", includeUntracked: true },
		);
		// Craft a valid checkpoint that records a different root, to exercise the filter.
		const head = (await revParse(runGit, repo, "HEAD")) as string;
		const tree = (await revParse(runGit, repo, "HEAD^{tree}")) as string;
		const foreign = await commitTree(
			runGit,
			repo,
			tree,
			head,
			encodeMessage(meta({ id: "foreign", root: "/elsewhere", head, tree, timestamp: 3000 })),
		);
		await updateRef(runGit, repo, refFor(NS, "foreign"), foreign);

		const all = await listCheckpoints(runGit, repo, NS);
		expect(all.map((checkpoint) => checkpoint.id)).toEqual(["foreign", "b", "a"]);

		const last = await getCheckpoint(runGit, repo, NS, "last");
		expect(last?.id).toBe("foreign");
		const byId = await getCheckpoint(runGit, repo, NS, "a");
		expect(byId?.id).toBe("a");

		const scoped = await listCheckpoints(runGit, repo, NS, { root: repo });
		expect(scoped.map((checkpoint) => checkpoint.id)).toEqual(["b", "a"]);
		const scopedLast = await getCheckpoint(runGit, repo, NS, "last", { root: repo });
		expect(scopedLast?.id).toBe("b");
	});

	test("prunes the oldest beyond max for a root", async () => {
		const fresh = await makeRepo("pi-cp-prune-");
		cleanups.push(fresh);
		for (const [time, id] of [
			[1000, "p1"],
			[2000, "p2"],
			[3000, "p3"],
		] as const) {
			await createCheckpoint(
				{ runGit, now: () => time, idFactory: () => id },
				{ root: fresh, indexFile: indexFileFor(fresh), namespace: NS, reason: "manual", includeUntracked: true },
			);
		}
		const removed = await pruneCheckpoints(runGit, fresh, NS, 2, fresh);
		expect(removed).toBe(1);
		const remaining = await listCheckpoints(runGit, fresh, NS, { root: fresh });
		expect(remaining.map((checkpoint) => checkpoint.id)).toEqual(["p3", "p2"]);
	});

	test("deleteCheckpoints removes refs", async () => {
		const checkpoints = await listCheckpoints(runGit, repo, NS);
		const removed = await deleteCheckpoints(runGit, repo, checkpoints);
		expect(removed).toBeGreaterThan(0);
		expect(await listCheckpoints(runGit, repo, NS)).toEqual([]);
	});
});
