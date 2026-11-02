/**
 * The one join: when a claim asks, and what a claim repeats when it asks again.
 *
 * The rule is one sentence and three answers — ask while the standing says nothing good,
 * keep a standing the roster still backs, ask again while it does not — and the cases here
 * are its boundaries: the record that aged out, the process that is gone, the host with no
 * session id, and the roster that will not read. The bus's files are real; nothing in this
 * module stubs the reader the round already uses.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { tempDir } from "../../test/helpers/env.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { removeBusRecord, writeBusRecord } from "../../test/helpers/bus.ts";
import { SESSION_TTL_MS } from "../session-roster.ts";
import type { JoinResult, TeamJoin, TeamJoinInput } from "../session-tool.ts";
import type { TeamStanding } from "./session.ts";
import { joinOnce, type JoinSession } from "./join.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 500_000;
const ID = "s-lead";
const LABEL = "billing-core";

/** What a case may vary about the session its claim joins as. */
interface JoinHarnessOptions {
	/** The standing the session already carries, or none when it has not asked yet. */
	record?: JoinResult;
	/** Make the join reject, so the swallow-and-record path is the one under test. */
	fails?: boolean;
	/** The bus directory the roster is read from; absence is a temp one. */
	busDir?: () => Promise<string>;
}

/**
 * One session, one recorded join, and a bus directory in a temp root.
 *
 * The join answers `ok` and records nothing on the bus itself: a case that wants the record
 * a real join leaves writes it, which is the only way to say "the bus holds this session"
 * and "the bus does not" with the same caller.
 */
function harness(options: JoinHarnessOptions = {}) {
	let standing = options.record;
	const busDir = temps.track(tempDir("pi-bus-join-"));
	const asked: Array<TeamJoinInput | undefined> = [];
	const team: TeamJoin = {
		async join(_ctx, input) {
			asked.push(input);
			if (options.fails === true) throw new Error("the bus went away");
			return { ok: true, label: LABEL, watching: { armed: true, wake: false } };
		},
	};
	const session: JoinSession = {
		team: {
			last: () => standing,
			record: (result) => {
				standing = result;
			},
		} satisfies TeamStanding,
		busDir: options.busDir ?? (async () => busDir),
		now: () => NOW,
	};
	const { ctx } = fakeCtx({ cwd: "/repo/billing", sessionId: ID });
	return { session, team, ctx, asked, busDir, standing: () => standing };
}

/** The joined standing, as a case seeds it: on the team, and armed unless it says not. */
function joined(watching: { armed: boolean; wake: boolean } = { armed: true, wake: false }): JoinResult {
	return { ok: true, label: LABEL, watching };
}

/** One live record for this session, where the roster reads it. */
function recordLive(busDir: string, lastSeen = NOW): string {
	return writeBusRecord(busDir, { id: ID, label: LABEL, lastSeen });
}

describe("joinOnce", () => {
	test("asks when this session has not asked yet, under the label the card was written as", async () => {
		const { session, team, ctx, asked } = harness();
		await joinOnce(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL }]);
	});

	test("keeps the standing while the roster still holds this session", async () => {
		const { session, team, ctx, asked, busDir } = harness({ record: joined() });
		recordLive(busDir);
		await joinOnce(session, team, ctx, LABEL);
		expect(asked).toEqual([]);
	});

	test("asks again when the bus stopped and took its record with it", async () => {
		const { session, team, ctx, asked, busDir } = harness({ record: joined() });
		const file = recordLive(busDir);
		await joinOnce(session, team, ctx, LABEL);
		expect(asked).toEqual([]);
		// A stop removes the record, and the standing is no evidence that peers resolve the
		// name any more: without this the next claim writes a card under a dead label.
		removeBusRecord(file);
		await joinOnce(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL }]);
	});

	test("asks again when the record aged out of the bus's TTL", async () => {
		const { session, team, ctx, asked, busDir } = harness({ record: joined() });
		recordLive(busDir, NOW - SESSION_TTL_MS - 1);
		await joinOnce(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL }]);
	});

	test("asks again when the only record is another session's", async () => {
		const { session, team, ctx, asked, busDir } = harness({ record: joined() });
		writeBusRecord(busDir, { id: "s-peer", label: "billing-web", lastSeen: NOW });
		await joinOnce(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL }]);
	});

	test("asks again after a failure, which a later attempt replaces", async () => {
		const { session, team, ctx, asked, busDir, standing } = harness({
			record: { ok: false, error: "the session bus is not loaded" },
		});
		recordLive(busDir);
		await joinOnce(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL }]);
		expect(standing()?.ok).toBe(true);
	});

	test("a live record that is not listening is the user's choice, not something to repair", async () => {
		const { session, team, ctx, asked, busDir } = harness({
			record: joined({ armed: false, wake: false }),
		});
		recordLive(busDir);
		await joinOnce(session, team, ctx, LABEL);
		expect(asked).toEqual([]);
	});

	test("repeats a disarmed join, so asking again cannot arm mail the user turned off", async () => {
		const { session, team, ctx, asked } = harness({ record: joined({ armed: false, wake: false }) });
		await joinOnce(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL, listen: false }]);
	});

	test("repeats an armed watch with the wake it had", async () => {
		const { session, team, ctx, asked } = harness({ record: joined({ armed: true, wake: true }) });
		await joinOnce(session, team, ctx, LABEL);
		expect(asked).toEqual([{ label: LABEL, wake: true }]);
	});

	test("keeps the standing for a host that reports no session id, which has no record to look for", async () => {
		const { session, team, asked } = harness({ record: joined() });
		const { ctx } = fakeCtx({ cwd: "/repo/billing", sessionId: "" });
		await joinOnce(session, team, ctx, LABEL);
		expect(asked).toEqual([]);
	});

	test("keeps the standing, and the card, when the roster cannot be read", async () => {
		const { session, team, ctx, asked } = harness({
			record: joined(),
			busDir: async () => {
				throw new Error("no agent directory");
			},
		});
		// The join runs after a card was written, so a bus that will not say is a sentence and
		// not a way to undo the claim it came after.
		await joinOnce(session, team, ctx, LABEL);
		expect(asked).toEqual([]);
	});

	test("records a join that threw as a failure, the way it records a refused one", async () => {
		const { session, team, ctx, standing } = harness({ fails: true });
		await joinOnce(session, team, ctx, LABEL);
		expect(standing()).toEqual({ ok: false, error: "the bus went away" });
	});
});
