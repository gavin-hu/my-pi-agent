import { describe, expect, test } from "bun:test";
import { JobChild as FakeChild, settle } from "../../test/helpers/process.ts";
import { makeClock } from "../../test/helpers/clock.ts";
import { BoundedLog, checkEnv, createRunner } from "./runner.ts";

/** A runner with one fake child and a clock. */
function harness() {
	const children: FakeChild[] = [];
	const killed: Array<{ pid: number; signal: string; force: boolean }> = [];
	const clock = makeClock(1000);
	const runner = createRunner({
		spawn: () => {
			const child = new FakeChild();
			child.pid = CHECK_PID;
			children.push(child);
			return child;
		},
		killTree: (pid, signal, force = false) => killed.push({ pid, signal, force }),
		now: clock.now,
		killGraceMs: 5,
	});
	return { runner, children, killed, clock };
}

/** The pid every fake check child reports. */
const CHECK_PID = 4242;

const base = { cwd: "/tmp", command: "npm run test", timeoutMs: 0, maxLogBytes: 1024 };

describe("BoundedLog", () => {
	test("keeps the tail and marks truncation", () => {
		const log = new BoundedLog(10);
		log.append("0123456789");
		expect(log.wasTruncated).toBe(false);
		log.append("abcdef");
		expect(log.text()).toBe("6789abcdef");
		expect(log.wasTruncated).toBe(true);
	});
});

describe("createRunner", () => {
	test("streams stdout and stderr and reports the exit code", async () => {
		const { runner, children, clock } = harness();
		const chunks: string[] = [];
		const promise = runner({ ...base, onOutput: (chunk) => chunks.push(chunk) });
		const child = children[0]!;
		child.write("out ");
		child.emitStderr("err");
		clock.advance(12);
		child.close(0);

		const outcome = await promise;
		expect(chunks).toEqual(["out ", "err"]);
		expect(outcome).toMatchObject({
			exitCode: 0,
			signal: null,
			timedOut: false,
			cancelled: false,
			output: "out err",
			truncated: false,
			durationMs: 12,
		});
	});

	test("keeps only the bounded tail", async () => {
		const { runner, children } = harness();
		const promise = runner({ ...base, maxLogBytes: 8 });
		children[0]!.write("0123456789abcdef");
		children[0]!.close(1);

		const outcome = await promise;
		expect(outcome.output).toBe("89abcdef");
		expect(outcome.truncated).toBe(true);
		expect(outcome.exitCode).toBe(1);
	});

	test("kills the tree on timeout and reports it", async () => {
		const { runner, children, killed } = harness();
		const promise = runner({ ...base, timeoutMs: 5 });
		await settle(10);
		expect(killed[0]).toEqual({ pid: CHECK_PID, signal: "SIGTERM", force: false });
		await settle(10);
		expect(killed.at(-1)).toEqual({ pid: CHECK_PID, signal: "SIGKILL", force: true });
		children[0]!.close(null, "SIGTERM");

		const outcome = await promise;
		expect(outcome.timedOut).toBe(true);
		expect(outcome.exitCode).toBeNull();
		expect(outcome.signal).toBe("SIGTERM");
	});

	test("kills the tree when the caller aborts", async () => {
		const { runner, children, killed } = harness();
		const controller = new AbortController();
		const promise = runner({ ...base, signal: controller.signal });
		controller.abort();
		expect(killed[0]).toEqual({ pid: CHECK_PID, signal: "SIGTERM", force: false });
		children[0]!.close(null, "SIGTERM");

		const outcome = await promise;
		expect(outcome.cancelled).toBe(true);
		expect(outcome.timedOut).toBe(false);
	});

	test("settles a spawn error with its message", async () => {
		const { runner, children } = harness();
		const promise = runner({ ...base });
		children[0]!.fail("ENOENT");
		children[0]!.close(null);

		const outcome = await promise;
		expect(outcome.error).toBe("ENOENT");
		expect(outcome.exitCode).toBeNull();
	});

	test("does not start when the signal is already aborted", async () => {
		const { runner, children } = harness();
		const controller = new AbortController();
		controller.abort();

		const outcome = await runner({ ...base, signal: controller.signal });
		expect(outcome.cancelled).toBe(true);
		expect(children).toHaveLength(0);
	});
});

describe("checkEnv", () => {
	test("adds the non-interactive defaults without dropping the base env", () => {
		const env = checkEnv({ HOME: "/home/u", CI: "wrong" });

		expect(env.HOME).toBe("/home/u");
		expect(env.CI).toBe("1");
		expect(env.NO_COLOR).toBe("1");
		expect(env.FORCE_COLOR).toBe("0");
		expect(env.TERM).toBe("dumb");
	});
});
