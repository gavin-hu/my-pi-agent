/**
 * The handoff: what `team assign` tells the peer, and how it tells it.
 *
 * The peer is a session that is already running, so this is a message and not a
 * process: `session send` writes it into the recipient's inbox, and its armed watch
 * is what raises the turn. Nothing here starts anything, and a send that fails leaves
 * the card exactly as it was — the order is deliberate, because a card assigned
 * without a message is a card nobody knows about.
 *
 * The transport is a seam (`Dispatch`), so the tool's ordering is testable without a
 * bus, and the one production implementation is a nested tool call.
 */

import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { Card } from "../../lib/board/card.ts";
import { cardRef, type CardOwner } from "../../lib/board/card.ts";
import { SESSION_TOOL } from "../../lib/tool-names.ts";

/** The `session send` text limit; a handoff is one paragraph and must fit. */
const MAX_HANDOFF = 4_000;

/** How a handoff reaches a peer. */
export interface Dispatch {
	/** Send the text, and report the labels a message file was written for. Throws on failure. */
	send: (to: string, text: string) => Promise<{ delivered: string[] }>;
}

/**
 * What the peer reads.
 *
 * It names the card, its outcome, the paths, and the two commands that make the
 * handoff real — `claim`, then `plan` — because the message is the only thing the
 * peer sees before it acts.
 */
export function handoffText(card: Card, to: string, note?: string): string {
	const lines = [
		`Handoff: ${cardRef(card.id)} "${card.title}" is yours, ${to}.`,
		card.paths.length > 0 ? `Paths: ${card.paths.join(", ")}` : undefined,
		card.plan === undefined ? undefined : `Plan: ${card.plan}`,
		note === undefined ? undefined : `Note: ${note}`,
		`Claim it with board action "claim", card "${card.id}" — then record the plan with action "plan" if it has none.`,
	].filter((line): line is string => line !== undefined);
	const text = lines.join("\n");
	return text.length > MAX_HANDOFF ? `${text.slice(0, MAX_HANDOFF - 1)}…` : text;
}

/**
 * The production dispatch: one nested `session send` as `kind: "handoff"`.
 *
 * A nested call never rejects, so the outcome's `isError` is the failure, and the
 * text of a failed result is the sentence the model would have read anyway.
 */
export function sessionDispatch(ctx: ExtensionToolContext): Dispatch {
	return {
		async send(to, text) {
			const outcome = await ctx.executeTool(SESSION_TOOL, { action: "send", to, kind: "handoff", text });
			if (outcome.isError) throw new Error(nestedMessage(outcome.result));
			const delivered = (outcome.result.details as { delivered?: unknown } | undefined)?.delivered;
			return {
				delivered: Array.isArray(delivered)
					? delivered.filter((label): label is string => typeof label === "string")
					: [],
			};
		},
	};
}

/** The message a failed nested call carries, or a sentence that says only that it failed. */
function nestedMessage(result: { content?: Array<{ type: string; text?: string }> } | undefined): string {
	const text = result?.content?.find((block) => block.type === "text")?.text;
	return text !== undefined && text !== "" ? text.replace(/^Error:\s*/, "") : "the handoff was not delivered.";
}

/** The peer a handoff names, as the card records it. */
export function ownerFor(to: string, delivered: readonly string[]): CardOwner {
	const label = delivered[0] ?? to;
	return { label };
}
