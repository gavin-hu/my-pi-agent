/**
 * The `land` door: the seat's verdicts around `lib/workflow/land.ts`'s fixed argv.
 *
 * Three questions are asked here rather than in the verb, because they are the board's own
 * records and not git's: is this session serving the page, is the card in `execute`, and does its
 * current spot-check name a tree. What is left is git, and the verb answers that. A refusal
 * carries the card it left alone, the way every other board refusal does.
 *
 * The door is its own module so `actions.ts` — twelve lines under the module ceiling when this
 * landed — pays five lines for the dispatch instead of a hundred, and it is `import()`ed for the
 * same reason: a session that never lands a card never loads the git seams it would need.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveEffectiveCwd } from "../../lib/env.ts";
import { createExecRunner } from "../../lib/git/runner.ts";
import { cardRef, normalizeCardId } from "../../lib/workflow/card.ts";
import type { Card } from "../../lib/workflow/card.ts";
import { missingSign } from "../../lib/workflow/lead.ts";
import { type LandRow, landCard } from "../../lib/workflow/land.ts";
import type { Actor } from "../../lib/workflow/rules.ts";
import { currentReview } from "../../lib/workflow/signs.ts";

/** The store the door reads: what it asks of a board, and nothing more, so a suite can answer it. */
export interface LandStore {
	read(id: string): Promise<Card | undefined>;
	config(): { lead: string };
}

/** What the door is handed: the tool's call, and the session making it. */
export interface LandDoorOptions {
	/** The host, for `pi.exec` — the git seam is `createExecRunner`'s. */
	pi: Pick<ExtensionAPI, "exec">;
	/** The session's board: the store, and the config the lead's name comes from. */
	runtime: { store(cwd: string): Promise<LandStore> };
	/** The call's context: its working directory is the checkout a landing runs in. */
	ctx: { cwd: string };
	/** Who is calling, as `who()` dressed them: only a session with `seat` may land. */
	me: Actor;
	/** The card the call named, as the model sent it: a call without one is refused, not defaulted. */
	card: string | undefined;
}

/** The answer the tool wraps: the landing's line, or the sentence that stopped it. */
export type LandDoorAnswer =
	| { kind: "landed"; text: string; card: Card }
	| { kind: "refused"; error: string; card?: Card };

/** What one landing's proof reads like: `CHANGELOG.md 5/0 · lead.ts 41/1`. */
export function proofText(rows: readonly LandRow[]): string {
	return rows.map((row) => `${row.path} ${row.added}/${row.deleted}`).join(" · ");
}

/**
 * Land the named card, or say why not.
 *
 * The seat check comes first because it is the leash this verb exists to work inside: a landing
 * from anywhere else is the hand-landing the card was written to replace, so the refusal names the
 * door that *is* open rather than the exit the seat's other refusals name.
 */
export async function landCardDoor(options: LandDoorOptions): Promise<LandDoorAnswer> {
	const { pi, runtime, ctx, me, card: raw } = options;
	if (me.seat !== true) {
		return {
			kind: "refused",
			error: `Only a session serving the page lands a card: \`/board\` takes the seat, and this session is ${me.label} — a landing from a shell is \`git merge\` by hand.`,
		};
	}
	const id = normalizeCardId(raw ?? "");
	if (id === undefined) {
		return { kind: "refused", error: `land needs a card id — try board action "land" with card "4".` };
	}
	const store = await runtime.store(ctx.cwd);
	const card = await store.read(id);
	if (card === undefined) return { kind: "refused", error: `${cardRef(id)} does not exist.` };
	if (card.lane !== "execute") {
		return {
			kind: "refused",
			error: `${cardRef(id)} is in ${card.lane}; a landing is what its spot-check opened, so it runs in \`execute\`.`,
			card,
		};
	}
	const lead = store.config().lead;
	const review = currentReview(card);
	if (review === undefined) return { kind: "refused", error: missingSign(card, lead, "review"), card };
	const evidence = review.verified;
	if (evidence?.sha === undefined || evidence.branch === undefined) {
		return {
			kind: "refused",
			error: `${cardRef(card.id)}'s spot-check records no tree: a landing needs the commit and the branch \`verify\` ran on — sign it again from the branch's worktree.`,
			card,
		};
	}
	const answer = await landCard({
		card,
		cwd: resolveEffectiveCwd(ctx.cwd),
		reviewed: { sha: evidence.sha, branch: evidence.branch },
		run: createExecRunner(pi),
	});
	if ("error" in answer) return { kind: "refused", error: answer.error, card };
	return {
		kind: "landed",
		text: `Landed: merge ${answer.merge.slice(0, 8)} — ${answer.subject}\nproof: ${proofText(answer.rows)} · pushed ${answer.pushed}`,
		card,
	};
}
