/**
 * The board and team tools in the gallery: a listing, the lead's rollup, and the two
 * round actions.
 *
 * The `details` here are the extensions' own types, so a change to them breaks this
 * file's build rather than the gallery's picture. The cards are `lib/board`'s own
 * records, which is also what the page's screenshot is built from, so the transcript
 * and the page describe the same board.
 */

import type { Card } from "../../../lib/board/card.ts";
import { buildRound } from "../../../lib/board/round.ts";
import type { BoardDetails } from "../../../extensions/board/types.ts";
import type { TeamDetails } from "../../../extensions/team/types.ts";
import type { ToolFixture } from "./types.ts";

const NOW = 1_760_000_000_000;

/**
 * The store the fixture's plans live in: the default agent directory, and this repository's key.
 *
 * `write_plan` saves into `<agent-dir>/plans/<repo-key>` and the board's `contract` records only
 * a file there, so this is the one spelling both halves of the fixture use — a path outside it
 * is one the shipped tool refuses.
 */
export const FIXTURE_PLAN_STORE = "~/.pi/agent/plans/8872d3adda0e";

/** One plan the fixture's cards are executed against, one file directly in that store. */
export function fixturePlanPath(slug: string): string {
	return `${FIXTURE_PLAN_STORE}/${slug}.md`;
}

/** One card, built the way the store would hold it. */
function card(overrides: Partial<Card> & Pick<Card, "id" | "title">): Card {
	return {
		v: 2,
		lane: "backlog",
		paths: [],
		notes: [],
		notesDropped: 0,
		rev: 1,
		createdAt: NOW - 900_000,
		updatedAt: NOW - 600_000,
		by: "billing-lead",
		...overrides,
	};
}

const CONTRACT = {
	goal: "A webhook order is stored once, whatever the gateway retries",
	acceptance: "A retried delivery leaves one order, and a test says so",
	scopeOut: "Refunds and partial captures",
};

const PLANNED = card({
	id: "1",
	title: "Billing webhook accepts orders",
	lane: "execute",
	owner: { id: "s-core", label: "billing-core" },
	paths: ["src/billing", "src/api"],
	planPath: fixturePlanPath("billing-webhook"),
	contract: { ...CONTRACT, approved: { by: "billing-lead", at: NOW - 200_000 } },
	review: { by: "billing-lead", at: NOW - 90_000 },
	notes: [{ by: "billing-core", at: NOW - 120_000, text: "routes wired; tests next" }],
	rev: 6,
	by: "billing-core",
});

const UNPLANNED = card({
	id: "2",
	title: "Retry branches merge cleanly into main",
	lane: "execute",
	owner: { id: "s-core", label: "billing-core" },
	paths: ["src/billing/retry"],
	rev: 3,
	by: "billing-core",
});

/** A card whose contract is complete and nobody has read: the lead's queue. */
const AWAITING = card({
	id: "6",
	title: "Round invoice totals at the boundary",
	lane: "plan",
	owner: { id: "s-core", label: "billing-core" },
	paths: ["src/billing/totals"],
	planPath: fixturePlanPath("totals-rounding"),
	contract: CONTRACT,
	rev: 4,
	by: "billing-core",
});

const BLOCKED = card({
	id: "3",
	title: "Webhook signature drift on the gateway",
	lane: "blocked",
	owner: { id: "s-core", label: "billing-core" },
	paths: ["src/api/gateway"],
	blocked: { kind: "decision", note: "the gateway owner has to confirm the algorithm" },
	notes: [{ by: "billing-core", at: NOW - 60_000, text: "waiting on the gateway owner" }],
	rev: 5,
	by: "billing-core",
});

const DONE = card({
	id: "4",
	title: "Export orders as CSV",
	lane: "done",
	owner: { id: "s-other", label: "billing-other" },
	paths: ["src/reports"],
	planPath: fixturePlanPath("export-orders"),
	contract: { ...CONTRACT, approved: { by: "billing-lead", at: NOW - 4_000_000 } },
	review: { by: "billing-lead", at: NOW - 3_700_000 },
	landed: { commit: "4af1b4a", at: NOW - 3_600_000 },
	notes: [{ by: "billing-other", at: NOW - 3_600_000, text: "shipped behind a flag" }],
	rev: 6,
	by: "billing-other",
});

const UNASSIGNED = card({ id: "5", title: "Invoice totals round the wrong way", paths: ["src/billing/totals"] });

/** The board the listing and the rollup share. */
const CARDS = [UNASSIGNED, AWAITING, PLANNED, UNPLANNED, BLOCKED, DONE];

const ME = { id: "s-lead", label: "billing-lead" };

/** A listing: the lanes in order, oldest first. */
const LISTED: BoardDetails = { action: "list", me: ME, cards: CARDS };

/** The lead's rollup of the same board. */
const ROUNDED: BoardDetails = { action: "list", me: ME, cards: CARDS, round: buildRound(CARDS, NOW) };

/** One assignment, as the tool reports it. */
const ASSIGNED: TeamDetails = {
	action: "assign",
	card: PLANNED,
	assigned: { id: "s-core", label: "billing-core" },
	delivered: ["billing-core"],
};

/** One reclaim, as the tool reports it. */
const RECLAIMED: TeamDetails = {
	action: "reclaim",
	card: { ...UNPLANNED, lane: "backlog", rev: 4 },
};

/** One finished card set aside, as the tool reports it. */
const ARCHIVED: BoardDetails = { action: "archive", me: ME, card: DONE, archived: [DONE.id] };

export const BOARD_FIXTURES: ToolFixture[] = [
	{
		name: "board",
		group: "package",
		label: "a board in reading order, collapsed to one line",
		args: { action: "list" },
		result: {
			content: [{ type: "text", text: "5 cards" }],
			details: LISTED,
		},
	},
	{
		name: "board-round",
		tool: "board",
		group: "package",
		label: "the lead's rollup, expanded into owners and groups",
		args: { action: "list", round: true },
		options: { expanded: true },
		result: {
			content: [{ type: "text", text: "5 cards · 1 owner" }],
			details: ROUNDED,
		},
	},
	{
		name: "board-refused",
		tool: "board",
		group: "package",
		label: "a claim another session already holds",
		args: { action: "claim", card: "1" },
		result: {
			content: [{ type: "text", text: "Error: #1 is held by billing-core." }],
			details: { action: "claim", me: ME, card: PLANNED, error: "#1 is held by billing-core." } as BoardDetails,
			isError: true,
		},
	},
	{
		name: "board-archived",
		tool: "board",
		group: "package",
		label: "a finished card set aside, out of the board and still readable",
		args: { action: "archive", card: "4" },
		result: {
			content: [
				{
					type: "text",
					text: "1 card archived: #4 — out of the board, its notes and plan still readable with archived: true.",
				},
			],
			details: ARCHIVED,
		},
	},
	{
		name: "board-contract",
		tool: "board",
		group: "package",
		label: "a contract written, waiting for a session that does not hold the card",
		args: { action: "contract", card: "6", path: fixturePlanPath("totals-rounding") },
		result: {
			content: [{ type: "text", text: "#6 plan · Round invoice totals at the boundary" }],
			details: { action: "contract", me: ME, card: AWAITING } as BoardDetails,
		},
	},
	{
		name: "board-gated",
		tool: "board",
		group: "package",
		label: "a move to execute refused until the contract is approved",
		args: { action: "move", card: "6", lane: "execute" },
		result: {
			content: [{ type: "text", text: "Error: #6 is in plan; its contract is not approved yet." }],
			details: {
				action: "move",
				me: ME,
				card: AWAITING,
				error:
					"#6 is in plan; its contract is not approved yet. A session that does not hold it approves with `approve`.",
			} as BoardDetails,
			isError: true,
		},
	},
	{
		name: "team",
		group: "package",
		label: "a card handed to a running session",
		args: { action: "assign", card: "1", to: "billing-core" },
		result: {
			content: [{ type: "text", text: "#1 handed off to billing-core." }],
			details: ASSIGNED,
		},
	},
	{
		name: "team-reclaimed",
		tool: "team",
		group: "package",
		label: "a card taken back to the pool, its notes kept",
		args: { action: "reclaim", card: "2" },
		result: {
			content: [{ type: "text", text: "#2 reclaimed from billing-core" }],
			details: RECLAIMED,
		},
	},
];
