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

/** The two sessions the fixture's cards belong to. */
export const LEAD: Actor = { id: "s-lead", label: "billing-lead" };
export const CORE: Actor = { id: "s-core", label: "billing-core" };
export const OTHER: Actor = { id: "s-other", label: "billing-other" };

/** The cards the fixture publishes, in the order they are created. */
export const FIXTURE_CARDS = [
	{
		title: "Billing webhook accepts orders",
		paths: ["src/billing", "src/api"],
		plan: "~/.pi/agent/plans/8872d3adda0e/billing-webhook.md",
		owner: CORE,
		lane: "doing" as const,
		notes: ["routes wired; tests next", "no retries yet"],
	},
	{
		title: "Retry branches merge cleanly into main",
		paths: ["src/billing/retry"],
		owner: CORE,
		lane: "doing" as const,
		priority: "high" as const,
		notes: ["needs a plan before it goes further"],
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
		owner: OTHER,
		lane: "done" as const,
		notes: ["shipped behind a flag"],
	},
	{
		title: "Invoice totals round the wrong way",
		paths: ["src/billing/totals"],
		lane: "todo" as const,
		notes: ["from the support thread"],
	},
	{
		title: "Document the retry policy",
		paths: ["docs/extensions"],
		lane: "todo" as const,
		// The one card that waits: an order is the reason a lead cannot just claim it.
		dependsOn: ["2"],
		notes: ["after the retry branches land"],
	},
];

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
		if (spec.lane === "blocked")
			await store.mutate(card.id, { kind: "move", lane: "blocked" }, spec.owner ?? LEAD, at + 3_000);
		if (spec.lane === "done")
			await store.mutate(card.id, { kind: "move", lane: "done" }, spec.owner ?? LEAD, at + 3_000);
		if (spec.lane === "doing" && "plan" in spec && spec.plan !== undefined) {
			await store.mutate(card.id, { kind: "plan", path: spec.plan }, spec.owner ?? LEAD, at + 4_000);
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
