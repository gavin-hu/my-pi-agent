/**
 * The board's fixture: one board with a card in each lane, so a capture shows the
 * page as a working one looks rather than as an empty shell.
 *
 * Shared by `scripts/shots/board.ts` (the page PNGs) and the tool gallery's fixture,
 * so the picture of the page and the picture of the tool cannot drift apart. Nothing
 * here names a real checkout: the paths are this repository's own directories, and
 * the store is a temporary directory. The page itself is served by
 * `test/helpers/board-page.ts`, so this module only holds the cards and the sessions.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Actor } from "../../../lib/board/rules.ts";
import type { RosterSession } from "../../../lib/session-roster.ts";
import { type BoardStore, createStore } from "../../../lib/board/store.ts";
import { fixturePlanPath } from "./board.ts";

/** The two sessions the fixture's cards belong to. */
export const LEAD: Actor = { id: "s-lead", label: "billing-lead" };
export const CORE: Actor = { id: "s-core", label: "billing-core" };
export const OTHER: Actor = { id: "s-other", label: "billing-other" };

/** The cards the fixture publishes, in the order they are created. */
export const FIXTURE_CARDS = [
	{
		title: "Billing webhook accepts orders",
		paths: ["src/billing", "src/api"],
		planPath: fixturePlanPath("billing-webhook"),
		owner: CORE,
		lane: "execute" as const,
		notes: ["routes wired; tests next", "no retries yet"],
	},
	{
		title: "Retry branches merge cleanly into main",
		paths: ["src/billing/retry"],
		planPath: fixturePlanPath("retry-branches"),
		owner: CORE,
		lane: "execute" as const,
		priority: "high" as const,
		notes: ["needs a plan before it goes further"],
	},
	{
		title: "Round invoice totals at the boundary",
		paths: ["src/billing/totals"],
		planPath: fixturePlanPath("totals-rounding"),
		owner: CORE,
		lane: "plan" as const,
		notes: ["contract written, waiting on the lead to read it"],
	},
	{
		title: "Webhook signature drift on the gateway",
		paths: ["src/api/gateway"],
		owner: CORE,
		lane: "blocked" as const,
		notes: ["waiting on the gateway owner to confirm the algorithm"],
	},
	{
		title: "Export orders as CSV",
		paths: ["src/reports"],
		planPath: fixturePlanPath("export-orders"),
		owner: OTHER,
		lane: "done" as const,
		notes: ["shipped behind a flag"],
	},
	{
		title: "Invoice totals round the wrong way",
		paths: ["src/billing/totals"],
		lane: "backlog" as const,
		notes: ["from the support thread"],
	},
	{
		title: "Document the retry policy",
		paths: ["docs/extensions"],
		lane: "backlog" as const,
		// The one card that waits: an order is the reason a lead cannot just claim it.
		dependsOn: ["2"],
		notes: ["after the retry branches land"],
	},
];

/**
 * The plan a spec records on the way out of the pool.
 *
 * A card that records a contract names its own plan, because the shipped `contract` records
 * only a file inside this repository's store; a fixture that invented a path would picture a
 * card the tool cannot make, so a spec that names none is a broken fixture and says so.
 */
function planOf(spec: (typeof FIXTURE_CARDS)[number]): string {
	const plan = "planPath" in spec ? spec.planPath : undefined;
	if (plan === undefined) throw new Error(`the fixture card "${spec.title}" leaves the pool with no plan`);
	return plan;
}

/** A store with the fixture's cards in it, in a temp directory. */
export async function seedStore(directory: string): Promise<void> {
	const store = createStore(directory);
	await store.ensure();
	// Stamped relative to now, so the page's ages read as a working board's would.
	const now = Date.now();
	for (const [index, spec] of FIXTURE_CARDS.entries()) {
		const at = now - (index + 1) * 7 * 60 * 1_000;
		const card = await store.create(
			{
				title: spec.title,
				paths: spec.paths,
				note: spec.notes[0],
				...("priority" in spec && spec.priority !== undefined ? { priority: spec.priority } : {}),
			},
			LEAD,
			at,
		);
		if (spec.owner !== undefined) await store.mutate(card.id, { kind: "claim" }, spec.owner, at + 1_000);
		for (const note of spec.notes.slice(1))
			await store.mutate(card.id, { kind: "note", text: note }, spec.owner ?? LEAD, at + 2_000);
		const owner = spec.owner ?? LEAD;
		if (spec.lane === "blocked") {
			await store.mutate(
				card.id,
				{ kind: "move", lane: "blocked", blocker: "decision", blockedBy: spec.notes.at(-1) },
				owner,
				at + 3_000,
			);
		}
		if (spec.lane === "plan" || spec.lane === "execute" || spec.lane === "done") {
			await store.mutate(
				card.id,
				{
					kind: "contract",
					// Every card that leaves the pool records a plan, and it is the one its spec
					// names: the store's own shape, so the record is one `contract` would accept.
					artifact: { path: planOf(spec) },
					goal: `The feature the card names, working: ${spec.title}`,
					acceptance: "A reader can tell it is done, and a test says so",
					scopeOut: "Anything the card does not name",
				},
				owner,
				at + 3_500,
			);
		}
		// The gates are two sessions' work: this fixture's owner writes, the lead approves.
		if (spec.lane === "execute" || spec.lane === "done") {
			const approver = owner.label === LEAD.label ? CORE : LEAD;
			await store.mutate(card.id, { kind: "approve" }, approver, at + 3_800);
			await store.mutate(
				card.id,
				{ kind: "move", lane: "execute", artifact: { path: planOf(spec) } },
				owner,
				at + 4_000,
			);
		}
		if (spec.lane === "done") {
			const reviewer = owner.label === LEAD.label ? CORE : LEAD;
			await store.mutate(card.id, { kind: "review" }, reviewer, at + 4_200);
			await store.mutate(
				card.id,
				{
					kind: "move",
					lane: "done",
					landed: { commit: "4af1b4a" },
					artifact: { path: planOf(spec) },
				},
				owner,
				at + 4_400,
			);
		}
		if ("dependsOn" in spec && spec.dependsOn !== undefined) {
			await store.mutate(
				card.id,
				{ kind: "edit", title: undefined, paths: undefined, priority: undefined, dependsOn: spec.dependsOn },
				LEAD,
				at + 5_000,
			);
		}
	}
}

/**
 * The bus sessions a capture shows, so the Team tab is photographed with every state
 * in it: the serving session with mail and listening, one that went quiet after
 * finishing, one live but not listening, one whose process is gone, and one owner with
 * no record at all (`billing-core` is left out on purpose). Nothing here reads a real
 * bus, and the gone row's pid is one no host is running.
 */
export function fixtureRoster(now: number): RosterSession[] {
	return [
		{
			id: "s-lead",
			// The serving session is the page's seat, and the page marks its own row.
			label: "team-lead",
			mode: "tui",
			lastSeen: now - 20_000,
			mail: 1,
			watching: { armed: true, wake: true },
		},
		{ id: "s-other", label: OTHER.label, mode: "tui", lastSeen: now - 42 * 60_000, mail: 0 },
		{
			id: "s-helper",
			label: "ops-helper",
			mode: "print",
			lastSeen: now - 5_000,
			mail: 0,
			watching: { armed: false, wake: false },
		},
		{
			// Above every host's pid range, so the roster's own rule calls it gone.
			id: "s-gone",
			label: "ops-relay",
			mode: "tui",
			lastSeen: now - 60_000,
			mail: 0,
			pid: 999_999_999,
		},
	];
}

/** A fixture store in a temp directory, for a caller that serves the page over it. */
export async function fixtureBoard(): Promise<{ directory: string; store: BoardStore }> {
	const directory = mkdtempSync(join(tmpdir(), "pi-board-shot-"));
	await seedStore(directory);
	return { directory, store: createStore(directory) };
}
