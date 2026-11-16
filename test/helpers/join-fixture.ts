/**
 * One session, one recorded join, and a bus directory in a temp root — the join suites' fixture.
 *
 * `joinTeam` is one body with two halves, read by two suites: what the bus record says about its
 * watch (`join-record.test.ts`), and when the door asks at all (`join.test.ts`). The harness they
 * both seed lives here rather than in two copies, because `test/shared-helpers.test.ts` fails a
 * declaration whose body matches one in another `*.test.ts` — and a fixture two suites seed is
 * exactly the body that rule is for. `test/helpers/bus.ts` is the neighbour it sits beside.
 *
 * The temp directory is tracked by the caller's `TempTracker`, so cleanup stays the suite's own
 * `afterAll`: a helper that owned the tracker would have to know when its suite ends.
 *
 * A join answers `ok` and records nothing on the bus itself: a case that wants the record a real
 * join leaves writes it, which is the only way to say "the bus holds this session" and "the bus
 * does not" with the same caller.
 */

import { tempDir } from "./env.ts";
import { fakeCtx } from "./context.ts";
import type { TempTracker } from "./git.ts";
import { writeBusRecord } from "./bus.ts";
import { type RosterSession, readRoster } from "../../lib/session-roster.ts";
import { type JoinResult, type TeamJoin, type TeamJoinInput } from "../../lib/session-tool.ts";
import type { TeamStanding } from "../../lib/workflow/session.ts";
import type { JoinSession } from "../../lib/workflow/join.ts";

/** The clock every case reads: an age is judged against it, so it cannot be the wall clock. */
export const NOW = 500_000;

/** The session id the fake context reports. */
export const ID = "s-lead";

/** The label a card is written as, and the name the page's seat renames. */
export const LABEL = "billing-core";

/** What a case may vary about the session its claim joins as. */
export interface JoinHarnessOptions {
	/** The standing the session already carries, or none when it has not asked yet. */
	record?: JoinResult;
	/** Make the join reject, so the swallow-and-record path is the one under test. */
	fails?: boolean;
	/** The sentence the bus refuses with, so the failure's own reading is the one under test. */
	refuses?: string;
	/** The roster the session reads; absence is the temp bus directory this harness writes. */
	roster?: () => Promise<RosterSession[] | undefined>;
}

/** The session, the bus it asks, what it asked, and the record directory a case may seed. */
export interface JoinHarness {
	session: JoinSession;
	team: TeamJoin;
	ctx: ReturnType<typeof fakeCtx>["ctx"];
	/** Every input the join was handed, in order: absent means it never asked. */
	asked: Array<TeamJoinInput | undefined>;
	busDir: string;
	/** The standing the session carries now, after the join recorded its answer. */
	standing: () => JoinResult | undefined;
}

/** One session, one recorded join, and a bus directory, seeded by the case. */
export function joinHarness(temps: TempTracker, options: JoinHarnessOptions = {}): JoinHarness {
	let standing = options.record;
	const busDir = temps.track(tempDir("pi-bus-join-"));
	const asked: Array<TeamJoinInput | undefined> = [];
	const team: TeamJoin = {
		async join(_ctx, input) {
			asked.push(input);
			if (options.fails === true) throw new Error("the bus went away");
			if (options.refuses !== undefined) return { ok: false, error: options.refuses };
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
		roster: options.roster ?? (() => readRoster(busDir)),
		now: () => NOW,
	};
	const { ctx } = fakeCtx({ cwd: "/repo/billing", sessionId: ID });
	return { session, team, ctx, asked, busDir, standing: () => standing };
}

/** The joined standing, as a case seeds it: on the team, and armed unless it says not. */
export function joinedStanding(watching: { armed: boolean; wake: boolean } = { armed: true, wake: false }): JoinResult {
	return { ok: true, label: LABEL, watching };
}

/** One live record for this session, where the roster reads it. */
export function liveRecord(busDir: string, lastSeen = NOW): string {
	return writeBusRecord(busDir, { id: ID, label: LABEL, lastSeen });
}
