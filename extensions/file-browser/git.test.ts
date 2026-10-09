import { describe, expect, test } from "bun:test";
import { makeClock } from "../../test/helpers/clock.ts";
import { createFakePi, type FakePiOptions } from "../../test/helpers/fakes.ts";
import { createGitStatus } from "./git.ts";

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
	test("maps branch and dirty state", async () => {
		const stub = gitStub([
			ROOT,
			["rev-parse --abbrev-ref HEAD", { stdout: "main\n" }],
			["status --porcelain", { stdout: " M a.ts\n" }],
		]);
		const provider = createGitStatus(createFakePi({ exec: stub.exec }).pi, "/repo");
		expect(await provider()).toMatchObject({ branch: "main", dirty: true });
	});

	test("reports a detached head when there is no branch", async () => {
		const stub = gitStub([
			ROOT,
			["rev-parse --abbrev-ref HEAD", { code: 1 }],
			["rev-parse --verify", { stdout: "abc1234def5678\n" }],
			["status --porcelain", { stdout: "" }],
		]);
		const provider = createGitStatus(createFakePi({ exec: stub.exec }).pi, "/repo");
		const status = await provider();
		expect(status?.branch).toBeUndefined();
		expect(status).toMatchObject({ head: "abc1234", dirty: false });
	});

	test("returns undefined outside a repository", async () => {
		const stub = gitStub([["rev-parse --show-toplevel", { code: 128 }]]);
		const provider = createGitStatus(createFakePi({ exec: stub.exec }).pi, "/repo");
		expect(await provider()).toBeUndefined();
	});

	test("returns undefined when status fails or exec throws", async () => {
		const failingStatus = gitStub([
			ROOT,
			["rev-parse --abbrev-ref HEAD", { stdout: "main\n" }],
			["status --porcelain", { code: 1 }],
		]);
		const first = createGitStatus(createFakePi({ exec: failingStatus.exec }).pi, "/repo");
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
