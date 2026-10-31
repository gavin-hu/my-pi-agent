/**
 * Whether a path is a plan of this repository: the board's half of the plan store.
 *
 * The board records the file a card is executed against, and that record is only worth
 * something if the file is the one `plan` wrote. The board does not parse a plan — it
 * resolves the path the model passed, requires it to be inside this repository's plan
 * store, and requires it to be there. So a contract cannot name a path to nothing, and a
 * card cannot enter `execute` on a plan somebody deleted after recording it.
 *
 * Two sentences per refusal, because the two moments ask different questions. At `contract`
 * the question is "may this be recorded", and the way out is "write the plan, then pass the
 * path it returned". At `execute` or `done` the question is "is the plan it recorded still
 * there", and the way out follows the card's lane — a card in `plan` can record again, and
 * one already executing has to come back to `plan` first, which is why {@link contractRoute}
 * is here rather than in each caller. One resolution body answers both: the store's rules
 * come from `plans/paths.ts`, so the board and the plan tool cannot disagree about what a
 * plan path is.
 *
 * The board still never reads a plan. A `stat` is the whole check, which is why this module
 * is the only place the board touches the plan store.
 */

import { statSync } from "node:fs";
import { sanitizeLine, shortenPath } from "../format.ts";
import { isInside } from "../path.ts";
import { isContainedPlan, isPlanFileName, resolvePlanArg } from "../plans/paths.ts";
import type { Card } from "./card.ts";
import { cardRef } from "./card.ts";

/** The plan a card is executed against, resolved and proved to exist. */
export interface PlanArtifact {
	/** The absolute path that was proved. */
	path: string;
	/**
	 * The stored plan path the proof was computed for.
	 *
	 * Only a re-check of a record carries it, and the gate compares it: a fact proved for
	 * one path cannot open a card whose recorded path is another, and a card whose path
	 * changed between the read and the write is refused rather than forced.
	 */
	recorded?: string;
}

/**
 * The resolved path, or the sentence refusing it.
 *
 * A union rather than two fields, so the tool hands the state machine one fact and the
 * state machine decides which refusal a caller hears first — an owner-check that fails
 * should be heard before a path that does not resolve.
 */
export type ArtifactCheck = PlanArtifact | { error: string };

/** What is inside the store at a resolved path. */
type Located =
	/** Not inside the store at all, or reached through a link that leaves it. */
	| { kind: "outside"; path: string }
	/** Inside the store, but not a markdown plan file. */
	| { kind: "named"; path: string }
	/** A plan name; what is at it, if anything. */
	| { kind: "plan"; path: string; file: boolean; present: boolean };

/** Resolve `rawPath` against `planDir`, and say what the store holds there. */
function locate(planDir: string, rawPath: string): Located {
	const path = resolvePlanArg(planDir, rawPath);
	if (!isContainedPlan(planDir, path)) {
		// `isContainedPlan` answers both questions at once, so the name rule is asked again
		// here: a `.txt` in the store deserves the sentence about its name, not about a link.
		return isInside(planDir, path) && !isPlanFileName(path) ? { kind: "named", path } : { kind: "outside", path };
	}
	try {
		const info = statSync(path);
		return { kind: "plan", path, present: true, file: info.isFile() };
	} catch {
		return { kind: "plan", path, present: false, file: false };
	}
}

/** One path as a refusal prints it: shortened, and never more than one line. */
function at(path: string): string {
	return sanitizeLine(shortenPath(path));
}

/**
 * How a card records the plan again, which depends on the lane it is in.
 *
 * `contract` is written in `plan` and nowhere else, so a refusal that names it from
 * `execute` would send a reader into another refusal — and from the pool the missing step is
 * the claim. A finished card cannot be re-planned at all; that branch is unreachable through
 * a gate, and says the fact rather than a route so the table is complete for its type.
 */
export function contractRoute(card: Pick<Card, "lane">): string {
	switch (card.lane) {
		case "plan":
			return "record it with `contract`.";
		case "backlog":
			return "claim it, then record it with `contract`.";
		case "blocked":
		case "execute":
			return "move it back to plan, then record it with `contract`.";
		case "done":
			return "a finished card's plan cannot change.";
	}
}

/** What `contract` may record: a plan of this repository, already written. */
export function planForContract(planDir: string, rawPath: string): ArtifactCheck {
	const found = locate(planDir, rawPath);
	if (found.kind === "outside") {
		return {
			error: `${at(found.path)} is not in this repository's plan store; \`plan\` action \`write\` saves into ${at(planDir)}.`,
		};
	}
	if (found.kind === "named") {
		return { error: `${at(found.path)} is not a markdown plan; \`plan\` action \`write\` saves into ${at(planDir)}.` };
	}
	if (!found.present) {
		return {
			error: `${at(found.path)} does not exist; \`plan\` action \`write\` saves the plan, and \`contract\` records the path it returns.`,
		};
	}
	if (!found.file)
		return { error: `${at(found.path)} is not a file; record the markdown file \`plan\` action \`write\` saves.` };
	return { path: found.path };
}

/**
 * What a card may enter `execute` or `done` on: the plan it recorded, still in the store.
 *
 * The recorded path may predate this rule — a card written when any string was accepted —
 * which is why an outside path refuses here with the same route out as a missing file.
 */
export function planForExecute(planDir: string, card: Pick<Card, "id" | "lane" | "planPath">): ArtifactCheck {
	const rawPath = card.planPath ?? "";
	const found = locate(planDir, rawPath);
	const route = ` ${contractRoute(card)}`;
	if (found.kind === "outside") {
		return { error: `${cardRef(card.id)}'s plan is outside this repository's plan store (${at(rawPath)});${route}` };
	}
	if (found.kind === "named") {
		return { error: `${cardRef(card.id)}'s recorded plan is not a markdown file (${at(rawPath)});${route}` };
	}
	if (!found.present) {
		return { error: `the plan recorded for ${cardRef(card.id)} is gone (${at(found.path)});${route}` };
	}
	if (!found.file) {
		return { error: `the plan recorded for ${cardRef(card.id)} is not a file (${at(found.path)});${route}` };
	}
	return { path: found.path, recorded: rawPath };
}
