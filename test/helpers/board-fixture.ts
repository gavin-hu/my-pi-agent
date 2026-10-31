/**
 * The working board two page suites drive: two cards to do, one being worked, and seven
 * finished.
 *
 * Seven rather than six is what puts the Done lane past its fold, which is a lane's state the
 * reader has to click to see. The card being worked carries a plan, a contract, its approval, a
 * priority, two path hints, and two notes, so a picture of it is the record at its fullest; one
 * of the finished cards landed as a commit and the rest finished outside a repository, which is
 * a board with no commit to record.
 *
 * It is seeded through the store and `advance`, so a suite given this board cannot be handed a
 * state the rules would refuse. One owner for one fixture: the page's behaviour suite and the
 * card dialog's suite read the same board, and a second copy of it is how the two drift.
 */

import type { BoardStore } from "../../lib/board/store.ts";
import type { Actor } from "../../lib/board/rules.ts";
import { advance } from "./board-flow.ts";

/** The two sessions the fixture's cards belong to. */
export const LEAD: Actor = { id: "s-lead", label: "billing-lead" };
export const CORE: Actor = { id: "s-core", label: "billing-core" };

/** The plan the card being worked is executed against, as the tool records it. */
export const WORKING_PLAN =
	"~/.pi/agent/plans/8872d3adda0e/2026-10-26-1105-the-card-dialog-reads-like-the-record-it-carries.md";

/** The board, seeded. */
export async function seedWorkingBoard(store: BoardStore, now: number): Promise<void> {
	const todo = [
		{ title: "Export orders as CSV", paths: ["src/reports"] },
		{ title: "Invoice totals round the wrong way", paths: ["src/billing/totals"] },
	];
	for (const [index, spec] of todo.entries()) {
		await store.create({ ...spec, note: "from the support thread" }, LEAD, now - index * 60_000);
	}
	const doing = await store.create(
		{
			title: "Billing webhook accepts orders",
			paths: ["src/billing", "src/api"],
			note: "routes wired",
			priority: "high",
		},
		LEAD,
		now - 120_000,
	);
	await store.mutate(doing.id, { kind: "claim" }, CORE, now - 119_000);
	// A contract and its approval, so the card can be executing: the page draws the plan
	// path from the dialog's ladder, and the lane the gates put it in.
	await store.mutate(
		doing.id,
		{
			kind: "contract",
			artifact: { path: WORKING_PLAN },
			goal: "A webhook order is stored once",
			acceptance: "A retried delivery leaves one order",
			scopeOut: "No refunds",
		},
		CORE,
		now - 119_500,
	);
	await store.mutate(doing.id, { kind: "note", text: "no retries yet" }, CORE, now - 118_000);
	await store.mutate(doing.id, { kind: "approve" }, LEAD, now - 118_500);
	await store.mutate(
		doing.id,
		{ kind: "move", lane: "execute", artifact: { path: WORKING_PLAN } },
		CORE,
		now - 118_000,
	);
	for (let index = 1; index <= 7; index++) {
		const card = await store.create(
			{ title: `Shipped change ${index}`, paths: ["src/old"] },
			LEAD,
			now - index * 300_000,
		);
		await advance(
			store,
			card.id,
			"done",
			{ owner: CORE, ...(index === 1 ? { landed: "4af1b4a" } : {}) },
			now - index * 300_000 + 1_000,
		);
	}
}
