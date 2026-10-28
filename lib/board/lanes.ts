/**
 * The board's lane vocabulary, and the one table that decides what each lane means.
 *
 * Five lanes, and a card is in exactly one of them: `backlog` is the pool nobody holds,
 * `plan` is where a contract is written and approved, `execute` is where the work happens,
 * `blocked` is a card waiting on a person, and `done` is closed. A lane is not a status
 * among others — an approval and a review are facts about a card, not places it can be —
 * so every surface reads this table rather than spelling a label, a colour, or a rule of
 * its own. The page receives it in the snapshot, the tool's schema is generated from
 * {@link LANES}, and `card.ts` reads the ownership invariant off `ownerless`.
 *
 * {@link TRANSITIONS} is the other half: the lanes a move may join, and what that move
 * requires first. `rules.ts` enforces the requirements and the tool stops carrying a
 * second copy of the list, which is how one surface came to offer a move another refused.
 *
 * Value-only: no I/O, no clock, no card. A caller that has a card reads `card.lane`.
 */

/** The lanes, in the order the page, the rollup, and the transcript read them. */
export const LANES = ["backlog", "plan", "execute", "blocked", "done"] as const;

/** One lane a card can sit in. */
export type Lane = (typeof LANES)[number];

/** The colours a lane may wear, as the roles `lib/tui` and the page's kit both name. */
export type LaneRole = "muted" | "warn" | "accent" | "danger" | "success";

/** What one lane means, in the words every surface uses. */
export interface LaneRule {
	/** The word a head, a row, and a sentence print: one name for one lane. */
	label: string;
	/** What an empty tray says, so a lane with no work reads as a fact rather than a blank. */
	empty: string;
	/** The colour the lane's dot, its reason line, and its dialog state take. */
	role: LaneRole;
	/**
	 * Whether a card in this lane has no owner.
	 *
	 * `backlog` is the pool, so a card nobody has taken belongs there; every other lane is
	 * somebody's, which is what a claim, a release, and `isCard`'s invariant turn on.
	 */
	ownerless: boolean;
	/** Whether the lane is the end of the line: nothing moves out of it. */
	terminal: boolean;
	/** Whether the lane admits cards by pull, and so is held to a WIP limit. */
	pulled: boolean;
}

/** One rule per lane, keyed by the lane itself so a lane cannot arrive without one. */
export const LANE_RULES: Record<Lane, LaneRule> = {
	backlog: {
		label: "Backlog",
		empty: "the pool is empty",
		role: "muted",
		ownerless: true,
		terminal: false,
		pulled: false,
	},
	plan: {
		label: "Plan",
		empty: "nothing being planned",
		role: "warn",
		ownerless: false,
		terminal: false,
		pulled: true,
	},
	execute: {
		label: "Execute",
		empty: "nothing in flight",
		role: "accent",
		ownerless: false,
		terminal: false,
		pulled: true,
	},
	blocked: {
		label: "Blocked",
		empty: "nothing blocked",
		role: "danger",
		ownerless: false,
		terminal: false,
		pulled: false,
	},
	done: {
		label: "Done",
		empty: "nothing finished yet",
		role: "success",
		ownerless: false,
		terminal: true,
		pulled: false,
	},
};

/**
 * What a move must satisfy before it is allowed.
 *
 * Each name is one gate `rules.ts` can answer from the card and the board: `contract` is
 * the three lines being present, `approval` is somebody who does not hold the card having
 * read them, `review` is the same for the finished work, `artifact` is the plan path the
 * work was done against, `blocker` is the recorded reason and kind, and `contract-defect`
 * is the one kind of block that sends a card back to planning.
 */
export const REQUIREMENTS = ["contract", "approval", "review", "artifact", "blocker", "contract-defect"] as const;

/** One requirement a transition may carry. */
export type Requirement = (typeof REQUIREMENTS)[number];

/** One lane change a `move` may make, and the gates in front of it. */
export interface Transition {
	from: Lane;
	to: Lane;
	/** Checked in this order, so a card missing two things hears about the first. */
	needs: readonly Requirement[];
}

/**
 * The lane changes a `move` may make.
 *
 * Absent pairs are refused, and the two absences that matter are deliberate: nothing moves
 * *into* `backlog` (a card nobody holds is `release`'s or `reclaim`'s decision, not a
 * move's), and nothing moves *out of* `done` (finished work is history). Re-planning is
 * `execute → plan`, and resuming is `blocked → execute`; only a contract defect sends a
 * blocked card back to `plan`.
 */
export const TRANSITIONS: readonly Transition[] = [
	{ from: "backlog", to: "plan", needs: [] },
	{ from: "plan", to: "execute", needs: ["contract", "approval"] },
	{ from: "plan", to: "blocked", needs: ["blocker"] },
	{ from: "execute", to: "plan", needs: [] },
	{ from: "execute", to: "blocked", needs: ["blocker"] },
	{ from: "execute", to: "done", needs: ["review", "artifact"] },
	{ from: "blocked", to: "plan", needs: ["contract-defect"] },
	{ from: "blocked", to: "execute", needs: [] },
];

/** The one transition from `from` to `to`, or `undefined` when a move may not make it. */
export function transitionOf(from: Lane, to: Lane): Transition | undefined {
	return TRANSITIONS.find((transition) => transition.from === from && transition.to === to);
}

/** Where a lane sits in {@link LANES}: the order a listing, a tray, and a rollup share. */
export function laneIndex(lane: Lane): number {
	return LANES.indexOf(lane);
}

/** Whether `value` is one of the lanes, so an untrusted lane is a refusal and not a crash. */
export function isLane(value: unknown): value is Lane {
	return typeof value === "string" && LANES.includes(value as Lane);
}

/** The lanes a `move` may name, in lane order: everything but `backlog`, which `release` reaches. */
export function movableLanes(): Lane[] {
	return LANES.filter((lane) => lane !== "backlog");
}

/**
 * The lanes a `move` from `lane` may reach, in lane order.
 *
 * A tool description and a refusal both read this: the alternative is the hand-written list
 * that drifted from `rules.ts` and offered a target the rule then refused.
 */
export function targetsFrom(lane: Lane): Lane[] {
	return LANES.filter((to) => transitionOf(lane, to) !== undefined);
}
