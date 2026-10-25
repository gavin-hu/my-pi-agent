/**
 * The board's fixture: one board with a card in each lane, so a capture shows the
 * page as a working one looks rather than as an empty shell.
 *
 * Shared by `scripts/shots/board.ts` (the page PNGs) and the tool gallery's fixture,
 * so the picture of the page and the picture of the tool cannot drift apart. Nothing
 * here names a real checkout: the paths are this repository's own directories, and
 * the store is a temporary directory.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Actor } from "../../../lib/board/rules.ts";
import type { RosterSession } from "../../../lib/session-roster.ts";
import { buildView, type BoardView } from "../../../lib/board/view.ts";
import { createStore } from "../../../lib/board/store.ts";

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
		status: "doing" as const,
		notes: ["routes wired; tests next", "no retries yet"],
	},
	{
		title: "Retry branches merge cleanly into main",
		paths: ["src/billing/retry"],
		owner: CORE,
		status: "doing" as const,
		notes: ["needs a plan before it goes further"],
	},
	{
		title: "Webhook signature drift on the gateway",
		paths: ["src/api/gateway"],
		owner: CORE,
		status: "blocked" as const,
		notes: ["waiting on the gateway owner to confirm the algorithm"],
	},
	{
		title: "Export orders as CSV",
		paths: ["src/reports"],
		owner: OTHER,
		status: "done" as const,
		notes: ["shipped behind a flag"],
	},
	{
		title: "Invoice totals round the wrong way",
		paths: ["src/billing/totals"],
		status: "todo" as const,
		notes: ["from the support thread"],
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
		const card = await store.create({ title: spec.title, paths: spec.paths, note: spec.notes[0] }, LEAD, at);
		if (spec.owner !== undefined) await store.mutate(card.id, { kind: "claim" }, spec.owner, at + 1_000);
		for (const note of spec.notes.slice(1))
			await store.mutate(card.id, { kind: "note", text: note }, spec.owner ?? LEAD, at + 2_000);
		if (spec.status === "blocked")
			await store.mutate(card.id, { kind: "move", status: "blocked" }, spec.owner ?? LEAD, at + 3_000);
		if (spec.status === "done")
			await store.mutate(card.id, { kind: "move", status: "done" }, spec.owner ?? LEAD, at + 3_000);
		if (spec.status === "doing" && spec.plan !== undefined) {
			await store.mutate(card.id, { kind: "plan", path: spec.plan }, spec.owner ?? LEAD, at + 4_000);
		}
	}
}

/**
 * The bus sessions a capture shows, so the Team tab is photographed with every state
 * in it: the serving session with mail, one that went quiet after finishing, one
 * holding nothing, and one owner with no record at all (`billing-core` is left out on
 * purpose). Nothing here reads a real bus.
 */
export function fixtureRoster(now: number): RosterSession[] {
	return [
		{ id: "s-lead", label: LEAD.label, mode: "tui", lastSeen: now - 20_000, mail: 1 },
		{ id: "s-other", label: OTHER.label, mode: "tui", lastSeen: now - 42 * 60_000, mail: 0 },
		{ id: "s-helper", label: "ops-helper", mode: "print", lastSeen: now - 5_000, mail: 0 },
	];
}

/** A fixture store in a temp directory, and the snapshot of it. */
export async function fixtureBoard(): Promise<{ directory: string; view: () => Promise<BoardView> }> {
	const directory = mkdtempSync(join(tmpdir(), "pi-board-shot-"));
	await seedStore(directory);
	const store = createStore(directory);
	return {
		directory,
		view: async () => {
			const now = Date.now();
			return buildView({
				me: LEAD,
				cards: await store.list(),
				now,
				roster: fixtureRoster(now),
				bytes: await store.bytes(),
				// A capture prints the store path, so it names the shape rather than a temp dir.
				where: "~/.pi/agent/board/8872d3adda0e",
			});
		},
	};
}
