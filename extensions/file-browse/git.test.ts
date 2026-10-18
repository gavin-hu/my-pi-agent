import { describe, expect, test } from "bun:test";
import { makeClock } from "../../test/helpers/clock.ts";
import { makeFixture } from "../../test/helpers/fixtures/file-browse.ts";
import { createFakePi, type FakePiOptions } from "../../test/helpers/fakes.ts";
import { createGitDiff, createGitStatus } from "./git.ts";

interface Reply {
	stdout?: string;
	code?: number;
}

/** A `pi.exec` stub that answers git by longest matching argument prefix. */
function gitStub(replies: Array<[prefix: string, reply: Reply]>): {
	exec: NonNullable<FakePiOptions["exec"]>;
	calls: () => number;
} {
	let calls = 0;
	const exec = async (_command: string, args: string[]) => {
		calls++;
		const key = args.join(" ");
		for (const [prefix, reply] of replies) {
			if (key.startsWith(prefix)) return { stdout: reply.stdout ?? "", stderr: "", code: reply.code ?? 0 };
		}
		return { stdout: "", stderr: "unexpected", code: 1 };
	};
	return { exec, calls: () => calls };
}

const ROOT: [string, Reply] = ["rev-parse --show-toplevel", { stdout: "/repo\n" }];

describe("createGitStatus", () => {
	test("maps the checked-out branch", async () => {
		const stub = gitStub([ROOT, ["rev-parse --abbrev-ref HEAD", { stdout: "main\n" }]]);
		const provider = createGitStatus(createFakePi({ exec: stub.exec }).pi, "/repo");
		expect(await provider()).toMatchObject({ branch: "main" });
	});

	test("reports a detached head when there is no branch", async () => {
		const stub = gitStub([
			ROOT,
			["rev-parse --abbrev-ref HEAD", { code: 1 }],
			["rev-parse --verify", { stdout: "abc1234def5678\n" }],
		]);
		const provider = createGitStatus(createFakePi({ exec: stub.exec }).pi, "/repo");
		const status = await provider();
		expect(status?.branch).toBeUndefined();
		expect(status).toMatchObject({ head: "abc1234" });
	});

	test("returns undefined outside a repository", async () => {
		const stub = gitStub([["rev-parse --show-toplevel", { code: 128 }]]);
		const provider = createGitStatus(createFakePi({ exec: stub.exec }).pi, "/repo");
		expect(await provider()).toBeUndefined();
	});

	test("returns undefined when git fails or exec throws", async () => {
		const failing = gitStub([ROOT, ["rev-parse --abbrev-ref HEAD", { code: 1 }], ["rev-parse --verify", { code: 1 }]]);
		const first = createGitStatus(createFakePi({ exec: failing.exec }).pi, "/repo");
		expect(await first()).toBeUndefined();

		const pi = createFakePi({
			exec: async () => {
				throw new Error("boom");
			},
		}).pi;
		const second = createGitStatus(pi, "/repo");
		expect(await second()).toBeUndefined();
	});

	test("caches within the ttl and refreshes after it", async () => {
		const clock = makeClock(1000);
		const stub = gitStub([
			ROOT,
			["rev-parse --abbrev-ref HEAD", { stdout: "main\n" }],
			["status --porcelain", { stdout: "" }],
		]);
		const provider = createGitStatus(createFakePi({ exec: stub.exec }).pi, "/repo", {
			ttlMs: 500,
			now: clock.now,
		});

		await provider();
		const afterFirst = stub.calls();
		await provider();
		expect(stub.calls()).toBe(afterFirst);

		clock.advance(600);
		await provider();
		expect(stub.calls()).toBeGreaterThan(afterFirst);
	});
});

const HEAD_OK: [string, Reply] = ["rev-parse --verify --quiet HEAD", { stdout: "abc1234def\n" }];

describe("createGitDiff", () => {
	test("lists changed files for a mode with its stat and totals", async () => {
		const stub = gitStub([
			ROOT,
			HEAD_OK,
			["status --porcelain=v1", { stdout: " M a.txt\0?? new file.txt\0" }],
			[
				"diff --no-color --stat HEAD --",
				{ stdout: " a.txt | 4 +-\n 1 file changed, 5 insertions(+), 3 deletions(-)\n" },
			],
		]);
		const diff = createGitDiff(createFakePi({ exec: stub.exec }).pi, "/repo");
		const list = await diff.list("head");
		expect(list?.mode).toBe("head");
		expect(list?.files.map((file) => file.rel)).toEqual(["a.txt", "new file.txt"]);
		expect(list?.stat).toContain("1 file changed");
		expect(list?.insertions).toBe(5);
		expect(list?.deletions).toBe(3);
	});

	test("reads the totals from the single --stat pass", async () => {
		let diffs = 0;
		const exec = async (_command: string, args: string[]) => {
			const key = args.join(" ");
			if (key.startsWith("rev-parse --show-toplevel")) return { stdout: "/repo\n", stderr: "", code: 0 };
			if (key.startsWith("rev-parse --verify")) return { stdout: "abc1234\n", stderr: "", code: 0 };
			if (key.startsWith("status --porcelain=v1")) return { stdout: " M a.txt\0", stderr: "", code: 0 };
			if (key.startsWith("diff --no-color")) {
				diffs++;
				return {
					stdout: " a.txt | 4 +-\n 1 file changed, 5 insertions(+), 3 deletions(-)\n",
					stderr: "",
					code: 0,
				};
			}
			return { stdout: "", stderr: "unexpected", code: 1 };
		};
		const diff = createGitDiff(createFakePi({ exec }).pi, "/repo");
		const list = await diff.list("head");
		expect(diffs).toBe(1);
		expect(list?.insertions).toBe(5);
		expect(list?.deletions).toBe(3);
	});

	test("reports zero totals when the stat is empty", async () => {
		const stub = gitStub([
			ROOT,
			HEAD_OK,
			["status --porcelain=v1", { stdout: " M a.bin\0" }],
			["diff --no-color --stat", { stdout: "" }],
		]);
		const diff = createGitDiff(createFakePi({ exec: stub.exec }).pi, "/repo");
		const list = await diff.list("head");
		expect(list?.insertions).toBe(0);
		expect(list?.deletions).toBe(0);
	});

	test("filters the list to the column each mode compares", async () => {
		const stub = gitStub([
			ROOT,
			HEAD_OK,
			["status --porcelain=v1", { stdout: " M a.txt\0M  b.txt\0?? c.txt\0" }],
			["diff --no-color --stat", { stdout: "" }],
		]);
		const diff = createGitDiff(createFakePi({ exec: stub.exec }).pi, "/repo");
		expect((await diff.list("staged"))?.files.map((file) => file.rel)).toEqual(["b.txt"]);
		expect((await diff.list("worktree"))?.files.map((file) => file.rel)).toEqual(["a.txt", "c.txt"]);
	});

	test("parses a per-file diff and requests a literal pathspec", async () => {
		let literal: string | undefined;
		const exec = async (_command: string, args: string[]) => {
			const key = args.join(" ");
			if (key.startsWith("rev-parse --show-toplevel")) return { stdout: "/repo\n", stderr: "", code: 0 };
			if (key.startsWith("rev-parse --verify")) return { stdout: "abc1234\n", stderr: "", code: 0 };
			if (key.startsWith("status --porcelain=v1")) return { stdout: " M a.ts\0", stderr: "", code: 0 };
			if (key.startsWith("diff --no-color -U3")) {
				literal = process.env.GIT_LITERAL_PATHSPECS;
				return { stdout: "@@ -1 +1 @@\n-old\n+new\n", stderr: "", code: 0 };
			}
			return { stdout: "", stderr: "unexpected", code: 1 };
		};
		const diff = createGitDiff(createFakePi({ exec }).pi, "/repo");
		const file = await diff.file("a.ts", "head");
		expect(file?.lines.map((line) => line.kind)).toEqual(["hunk", "del", "add"]);
		expect(literal).toBe("1");
	});

	test("renders an untracked file as an all-add diff", async () => {
		const fixture = makeFixture();
		try {
			const stub = gitStub([ROOT, HEAD_OK, ["status --porcelain=v1", { stdout: "?? a.txt\0" }]]);
			const diff = createGitDiff(createFakePi({ exec: stub.exec }).pi, fixture.root);
			const file = await diff.file("a.txt", "worktree");
			expect(file?.binary).toBe(false);
			expect(file?.lines).toEqual([
				{ kind: "add", text: "hello", newNo: 1 },
				{ kind: "add", text: "world", newNo: 2 },
			]);
		} finally {
			fixture.remove();
		}
	});

	test("falls back to the index when there is no commit", async () => {
		const seen: string[] = [];
		const exec = async (_command: string, args: string[]) => {
			const key = args.join(" ");
			if (key.startsWith("rev-parse --show-toplevel")) return { stdout: "/repo\n", stderr: "", code: 0 };
			if (key.startsWith("rev-parse --verify")) return { stdout: "", stderr: "", code: 1 };
			if (key.startsWith("status --porcelain=v1")) return { stdout: "A  s.txt\0", stderr: "", code: 0 };
			if (key.startsWith("diff --no-color --stat")) {
				seen.push(key);
				return { stdout: "", stderr: "", code: 0 };
			}
			return { stdout: "", stderr: "unexpected", code: 1 };
		};
		const diff = createGitDiff(createFakePi({ exec }).pi, "/repo");
		const list = await diff.list("head");
		expect(list?.files.map((file) => file.rel)).toEqual(["s.txt"]);
		expect(seen[0]).toContain("--cached");
		expect(seen[0]).not.toContain("HEAD");
	});

	test("returns undefined outside a repository or on failure", async () => {
		const outside = gitStub([["rev-parse --show-toplevel", { code: 128 }]]);
		const diff = createGitDiff(createFakePi({ exec: outside.exec }).pi, "/repo");
		expect(await diff.list("head")).toBeUndefined();
		expect(await diff.file("a.ts", "head")).toBeUndefined();

		const pi = createFakePi({
			exec: async () => {
				throw new Error("boom");
			},
		}).pi;
		expect(await createGitDiff(pi, "/repo").list("head")).toBeUndefined();
	});

	test("caches the status list within the ttl", async () => {
		const clock = makeClock(1000);
		let statusCalls = 0;
		const exec = async (_command: string, args: string[]) => {
			const key = args.join(" ");
			if (key.startsWith("rev-parse --show-toplevel")) return { stdout: "/repo\n", stderr: "", code: 0 };
			if (key.startsWith("rev-parse --verify")) return { stdout: "abc1234\n", stderr: "", code: 0 };
			if (key.startsWith("status --porcelain=v1")) {
				statusCalls++;
				return { stdout: " M a.txt\0", stderr: "", code: 0 };
			}
			if (key.startsWith("diff --no-color --stat")) return { stdout: "", stderr: "", code: 0 };
			return { stdout: "", stderr: "unexpected", code: 1 };
		};
		const diff = createGitDiff(createFakePi({ exec }).pi, "/repo", { ttlMs: 500, now: clock.now });
		await diff.list("head");
		await diff.list("staged");
		expect(statusCalls).toBe(1);
		clock.advance(600);
		await diff.list("head");
		expect(statusCalls).toBe(2);
	});
});
