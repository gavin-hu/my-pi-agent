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

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Card } from "../../../lib/board/card.ts";
import { planForContract } from "../../../lib/board/artifact.ts";
import { provedPlan } from "../../../extensions/board/proof.ts";
import { boardConfig, type BoardConfig } from "../../../lib/board/config.ts";
import { personActor } from "../../../lib/board/lead.ts";
import type { Actor, CardOp } from "../../../lib/board/rules.ts";
import type { RosterSession } from "../../../lib/session-roster.ts";
import type { WaitingMail } from "../../../lib/session-mail.ts";
import { type BoardStore, createStore } from "../../../lib/board/store.ts";
import { resolvePlanArg } from "../../../lib/plans/paths.ts";
import { fixturePlanDir, fixturePlanPath } from "./board.ts";

/** The two sessions the fixture's cards belong to. */
export const LEAD: Actor = { id: "s-lead", label: "billing-lead" };
export const CORE: Actor = { id: "s-core", label: "billing-core" };
export const OTHER: Actor = { id: "s-other", label: "billing-other" };

/** The cards the fixture publishes, in the order they are created. */
export const FIXTURE_CARDS = [
	{
		title: "Billing webhook accepts orders",
		paths: ["src/billing", "src/api"],
		plan: "billing-webhook",
		owner: CORE,
		lane: "execute" as const,
		type: "feature" as const,
		// The one card whose sign the owner never heard: the face draws ` · not told` off it.
		untold: true,
		notes: ["routes wired; tests next", "no retries yet"],
	},
	{
		title: "Retry branches merge cleanly into main",
		paths: ["src/billing/retry"],
		plan: "retry-branches",
		owner: CORE,
		lane: "execute" as const,
		priority: "high" as const,
		type: "chore" as const,
		notes: ["needs a plan before it goes further"],
	},
	{
		title: "Round invoice totals at the boundary",
		paths: ["src/billing/totals"],
		plan: "totals-rounding",
		owner: CORE,
		lane: "plan" as const,
		type: "bug" as const,
		notes: ["contract written, waiting on the lead to read it"],
	},
	{
		title: "Webhook signature drift on the gateway",
		paths: ["src/api/gateway"],
		owner: CORE,
		lane: "blocked" as const,
		type: "bug" as const,
		breaking: true,
		notes: ["waiting on the gateway owner to confirm the algorithm"],
	},
	{
		title: "Export orders as CSV",
		paths: ["src/reports"],
		plan: "export-orders",
		owner: OTHER,
		lane: "done" as const,
		type: "feature" as const,
		notes: ["shipped behind a flag"],
	},
	{
		title: "Invoice totals round the wrong way",
		paths: ["src/billing/totals"],
		lane: "backlog" as const,
		type: "bug" as const,
		notes: ["from the support thread"],
	},
	{
		title: "Document the retry policy",
		paths: ["docs/extensions"],
		lane: "backlog" as const,
		type: "docs" as const,
		// The one card that waits: an order is the reason a lead cannot just claim it.
		dependsOn: ["2"],
		notes: ["after the retry branches land"],
	},
];

/**
 * The plan file a spec records on the way out of the pool, spelled as the card records it.
 *
 * A card that records a contract names its own plan, because the shipped `contract` records
 * only a file inside this repository's store; a fixture that invented a path would picture a
 * card the tool cannot make, so a spec that names none is a broken fixture and says so.
 */
function planOf(spec: (typeof FIXTURE_CARDS)[number], planDir: string): string {
	const plan = "plan" in spec ? spec.plan : undefined;
	if (plan === undefined) throw new Error(`the fixture card "${spec.title}" leaves the pool with no plan`);
	return fixturePlanPath(planDir, plan);
}

/**
 * The settings the fixture board works by: `billing-lead` signs, and the lanes hold the
 * default numbers.
 *
 * The lead is what the two gates take, so a fixture that wants cards in `execute` and `done`
 * has to name one — and the signer that is not the owner is the person at the keyboard, which
 * is what a case where the lead owns the card needs.
 */
const FIXTURE_CONFIG: BoardConfig = boardConfig({ lead: LEAD.label });

/**
 * What a seed wrote, so a caller can undo it and nothing else.
 *
 * `plans` holds the plan files this seed created: a name the store already held is proved but
 * never rewritten, so it is never removed either. That is the one path where a careless close
 * would delete a real plan.
 */
export interface SeededBoard {
	/** The plan files this seed created, by absolute path. */
	plans: string[];
}

/**
 * A store with the fixture's cards in it, and the plans their contracts named.
 *
 * The seed goes through the shipped gates rather than around them: a plan file is written where
 * the record says, `contract`, `approve` and `move` are handed the proof the shipped doors hand
 * them, and a refusal throws. A fixture that cannot seed stops the capture instead of drawing a
 * board nobody would recognise — which is how this fixture once photographed seven unassigned
 * cards after the plan gate learned to prove the file.
 */
export async function seedStore(directory: string, planDir: string, now = Date.now()): Promise<SeededBoard> {
	const store = createStore(directory, { config: FIXTURE_CONFIG });
	await store.ensure();
	// One proof per write, asked where the rule asks it: the store's lock is taken after a door
	// hands the question over, so a fact taken here would be a fact about a moment already gone.
	const provedFor = (file: string) => () => planForContract(planDir, file);
	const recorded = async (card: Card) => provedPlan({ planDir: async () => planDir }, directory, store, card.id);
	/** One step the seed cannot skip: a refused write names the card and what was attempted. */
	const step = async (card: Card, what: string, op: CardOp, actor: Actor, at: number): Promise<Card> => {
		const result = await store.mutate(card.id, op, actor, at);
		if (!result.ok) throw new Error(`${card.title}: ${what} was refused — ${result.error}`);
		return result.card;
	};
	const plans: string[] = [];
	// The files first: the gate proves the plan at the write, so a record naming a file written
	// later would be refused on the way to the very write that records it.
	for (const spec of FIXTURE_CARDS) {
		if (!("plan" in spec) || spec.plan === undefined) continue;
		const file = resolvePlanArg(planDir, fixturePlanPath(planDir, spec.plan));
		if (existsSync(file)) continue;
		mkdirSync(planDir, { recursive: true });
		writeFileSync(file, `# ${spec.title}\n\nA fixture plan, so the card's record names a file the gate can prove.\n`);
		plans.push(file);
	}
	for (const [index, spec] of FIXTURE_CARDS.entries()) {
		const at = now - (index + 1) * 7 * 60 * 1_000;
		let card = await store.create(
			{
				title: spec.title,
				paths: spec.paths,
				note: spec.notes[0],
				...("priority" in spec && spec.priority !== undefined ? { priority: spec.priority } : {}),
				...("type" in spec && spec.type !== undefined ? { type: spec.type } : {}),
				...("breaking" in spec && spec.breaking === true ? { breaking: true } : {}),
			},
			LEAD,
			at,
		);
		const owner = spec.owner ?? LEAD;
		if (spec.owner !== undefined) card = await step(card, "claim", { kind: "claim" }, spec.owner, at + 1_000);
		for (const note of spec.notes.slice(1))
			card = await step(card, "note", { kind: "note", text: note }, owner, at + 2_000);
		if (spec.lane === "blocked") {
			card = await step(
				card,
				"move to blocked",
				{ kind: "move", lane: "blocked", blocker: "decision", blockedBy: spec.notes.at(-1) },
				owner,
				at + 3_000,
			);
		}
		if (spec.lane === "plan" || spec.lane === "execute" || spec.lane === "done") {
			const file = planOf(spec, planDir);
			card = await step(
				card,
				"contract",
				{
					kind: "contract",
					artifact: provedFor(file),
					goal: `The feature the card names, working: ${spec.title}`,
					acceptance: "A reader can tell it is done, and a test says so",
					scopeOut: "Anything the card does not name",
					verify: "bun run check",
				},
				owner,
				at + 3_500,
			);
		}
		// The gates are the lead's, or the person's when the lead owns the card.
		if (spec.lane === "execute" || spec.lane === "done") {
			const approver = owner.label === LEAD.label ? personActor() : LEAD;
			const proof = await recorded(card);
			card = await step(
				card,
				"approve",
				{ kind: "approve", ...(proof === undefined ? {} : { artifact: proof }) },
				approver,
				at + 3_800,
			);
			// The door records `announced` only after its message settles, so a seed with no bus leaves
			// `told` absent. That is the state one card is drawn in on purpose.
			if (!("untold" in spec))
				card = await step(card, "announced", { kind: "announced", sign: "approve" }, approver, at + 3_900);
			const move = await recorded(card);
			card = await step(
				card,
				"move to execute",
				{ kind: "move", lane: "execute", ...(move === undefined ? {} : { artifact: move }) },
				owner,
				at + 4_000,
			);
		}
		if (spec.lane === "done") {
			const reviewer = owner.label === LEAD.label ? personActor() : LEAD;
			// The contract names a command, so the seed's sign carries the run that answers for it.
			const run = { cmd: "bun run check", exit: 0, at: at + 4_200 };
			card = await step(card, "review", { kind: "review", verified: run }, reviewer, at + 4_200);
			card = await step(card, "announced review", { kind: "announced", sign: "review" }, reviewer, at + 4_300);
			const move = await recorded(card);
			await step(
				card,
				"move to done",
				{ kind: "move", lane: "done", ...(move === undefined ? {} : { artifact: move }) },
				owner,
				at + 4_400,
			);
		}
		if ("dependsOn" in spec && spec.dependsOn !== undefined) {
			await step(
				card,
				"edit",
				{ kind: "edit", title: undefined, paths: undefined, priority: undefined, dependsOn: spec.dependsOn },
				LEAD,
				at + 5_000,
			);
		}
	}
	return { plans };
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
			// The serving session is the page's seat — the board's configured lead — so the page
			// marks this row `you`, and the pin puts it first.
			label: LEAD.label,
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
			// Inside a turn: the one state a heartbeat alone cannot show.
			turnAt: now - 5_000,
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

/**
 * The mail a capture shows waiting: one handoff nobody has read, and one broadcast, so the
 * Activity column is photographed with both shapes of a queue row — a single recipient with
 * its state dot, and a message waiting on three.
 */
export function fixtureWaiting(now: number): WaitingMail[] {
	// In the reader's own order — oldest first, the item waiting longest at the top — so the
	// picture shows the queue the page draws rather than a list sorted for the eye.
	return [
		{
			id: "m-2",
			from: "s-helper",
			fromLabel: "ops-helper",
			kind: "event",
			to: [LEAD.label, "ops-relay", OTHER.label],
			text: "the gateway is back; the cards parked on it can move",
			at: now - 12 * 60_000,
		},
		{
			id: "m-1",
			from: "s-lead",
			fromLabel: LEAD.label,
			kind: "handoff",
			to: ["billing-core"],
			text: "take the contract review on #4 while I am in the webhook drift card",
			at: now - 4 * 60_000,
		},
	];
}

/**
 * A fixture board in a temp directory, proved against this repository's real plan store.
 *
 * The plans are the one thing a capture cannot fake: the gate stats the file the record names,
 * and the card dialog prints that record, so the store has to be the real one for the picture
 * to read `~/…` and be true. `close()` removes what the seed created and nothing else.
 */
export async function fixtureBoard(now = Date.now()): Promise<{ directory: string; store: BoardStore; close(): void }> {
	const directory = mkdtempSync(join(tmpdir(), "pi-board-shot-"));
	const seeded = await seedStore(directory, fixturePlanDir(), now);
	return {
		directory,
		store: createStore(directory, { config: FIXTURE_CONFIG }),
		close() {
			rmSync(directory, { recursive: true, force: true });
			for (const plan of seeded.plans) rmSync(plan, { force: true });
		},
	};
}
