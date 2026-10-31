/**
 * The handoff: what `team assign` tells the peer, and how it tells it.
 *
 * The peer is a session that is already running, so this is a message and not a
 * process: `session send` writes it into the recipient's inbox, and its armed watch is
 * what raises the turn. Nothing here starts anything, and a send that fails leaves the
 * card exactly as it was — the order is deliberate, because a card assigned without a
 * message is a card nobody knows about.
 *
 * The transport is a seam (`Dispatch`), so the tool's ordering is testable without a
 * bus, and the one production implementation is `lib/session-tool.ts`'s.
 */

import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { Card } from "../../lib/board/card.ts";
import { cardRef, type CardOwner } from "../../lib/board/card.ts";
import type { Lead } from "../../lib/board/lead.ts";
import type { Actor } from "../../lib/board/rules.ts";
import { listPeers, MAX_MESSAGE_TEXT, type Peer, send as sendTo } from "../../lib/session-tool.ts";

/** How a handoff reaches a peer, and what the bus can say about the peers there are. */
export interface Dispatch {
	/** Send the text as `kind`, and report the labels a message file was written for. Throws on failure. */
	send(input: { kind: "handoff" | "event"; to: string; text: string }): Promise<{ delivered: string[] }>;
	/**
	 * Every session the bus lists, when it can say.
	 *
	 * Its record is what makes an assignment survive a rename — `holds` compares ids
	 * before labels — and what makes the report able to name a peer that cannot be
	 * woken. It never throws: a resolve that fails must not undo a handoff that landed.
	 */
	peers(): Promise<Peer[] | undefined>;
}

/**
 * What the peer reads.
 *
 * It names the card and its outcome, says what to do next — record the plan, work, note,
 * and which moves are the peer's own — and then the paths it needs. The instruction comes
 * before the paths because the paths are the only line that can run past the bus's limit,
 * and a clipped message must not lose the step it was sent to give. It does **not** ask
 * the peer to claim the card — `assign` has already recorded the owner, and a claim by the
 * holder is a no-op. The claim is only for the failure path where the send landed and the
 * assignment did not.
 */
export function handoffText(card: Card, to: string, lead: Lead, note?: string): string {
	const lines = [
		`Handoff: ${cardRef(card.id)} "${card.title}" is yours, ${to}.`,
		`It is already assigned to you — write its contract with board action "contract" if it has none, then note each phase.`,
		signatureLine(lead),
		card.paths.length > 0 ? `Paths: ${card.paths.join(", ")}` : undefined,
		card.planPath === undefined ? undefined : `Plan: ${card.planPath}`,
		note === undefined ? undefined : `Note: ${note}`,
	].filter((line): line is string => line !== undefined);
	return withinLimit(lines.join("\n"));
}

/**
 * What every live session reads when the lead offers a card instead of assigning it.
 *
 * An offer names no owner: the first peer to claim the card takes it, so the text says
 * what the card is and that claiming is the next step, and it never implies the work is
 * already somebody's. The claim and the two gates come before the paths, for the reason
 * `handoffText` does: the step is what the message is for.
 */
export function offerText(card: Card, lead: Lead, note?: string): string {
	const lines = [
		`Offer: ${cardRef(card.id)} "${card.title}" is unclaimed.`,
		`First to claim it takes it: run board action "claim" with card "${card.id}", then write its contract and note each phase.`,
		signatureLine(lead),
		card.paths.length > 0 ? `Paths: ${card.paths.join(", ")}` : undefined,
		card.planPath === undefined ? undefined : `Plan: ${card.planPath}`,
		note === undefined ? undefined : `Note: ${note}`,
	].filter((line): line is string => line !== undefined);
	return withinLimit(lines.join("\n"));
}

/**
 * The moves a card has left, and which of them the peer may make itself.
 *
 * Both gates are the lead's signature — `lib/board/steps.ts` refuses `plan`→`execute`
 * without `approve` and `done` without `review`, and refuses a signer who holds the card —
 * so a message that said "move it to execute, blocked, or done" handed the peer an
 * instruction its own next call would refuse. The name is the configured lead, which is the
 * one a sign has to carry, and the way to ask it is `session send`, the same channel that
 * carried this message.
 */
function signatureLine(lead: Lead): string {
	return `Its three moves: \`blocked\` is yours to set; \`execute\` needs the lead (${lead}) to \`approve\` the contract, and \`done\` needs the lead's \`review\` — ask ${lead} with \`session send\` when each is ready.`;
}

/**
 * Trim to the bus's text limit, which is also this message's limit.
 *
 * Not `lib/tui/columns.ts`'s `clip`: that one measures terminal columns, and this one
 * counts characters, because the bus's limit is characters. The number arrives from
 * `lib/session-tool.ts` — one copy for the two extensions that send through it.
 */
function withinLimit(text: string): string {
	return text.length > MAX_MESSAGE_TEXT ? `${text.slice(0, MAX_MESSAGE_TEXT - 1)}…` : text;
}

/** The production dispatch: `lib/session-tool.ts`, with a failure turned into a throw. */
export function sessionDispatch(ctx: ExtensionToolContext): Dispatch {
	return {
		async send(input) {
			const result = await sendTo(ctx, input);
			// `assign` and `offer` branch on a failed send, so this seam reports it the way
			// they read it: the bus's sentence, as the reason the card was not handed over.
			if (!result.ok) throw new Error(result.error);
			return { delivered: result.delivered };
		},
		peers: () => listPeers(ctx),
	};
}

/**
 * The peer `to` names: an id exactly, else a label ignoring case.
 *
 * The send has already proved exactly one session answers to it, so the first match is
 * the recipient; a miss means the bus could not say, which is why the caller falls back
 * to the label alone.
 */
export function peerFor(peers: readonly Peer[] | undefined, to: string): Peer | undefined {
	if (peers === undefined) return undefined;
	const target = to.trim();
	const byId = peers.find((peer) => peer.id === target);
	if (byId) return byId;
	const wanted = target.toLowerCase();
	return peers.find((peer) => peer.label.toLowerCase() === wanted);
}

/**
 * The labels a message reached that cannot be woken: their record says they are not
 * listening.
 *
 * A label the bus could not answer for is left out — "the record does not say" is not
 * "nobody will read it" — and so is a peer the bus lists as listening.
 */
export function notListening(peers: readonly Peer[] | undefined, labels: readonly string[]): string[] {
	if (peers === undefined) return [];
	return labels.filter((label) => {
		const peer = peerFor(peers, label);
		return peer !== undefined && peer.listening === false;
	});
}

/**
 * The actor a handoff names: the peer the bus lists, else the label that was asked for.
 *
 * `team assign` checks the card against this before it sends anything and records the same
 * actor afterwards, so the check and the write cannot disagree about who `to` is. That is
 * what makes an id the holder: a card records the id the bus gave it, `holds` compares ids
 * first, and only the resolved actor carries one.
 */
export function actorFor(peers: readonly Peer[] | undefined, to: string): Actor {
	const peer = peerFor(peers, to);
	return peer === undefined ? { label: to.trim() } : { id: peer.id, label: peer.label };
}

/**
 * The peer a handoff names, as the card records it when the bus cannot say who that
 * is: the label a message file was written for, else the one that was asked for.
 */
export function ownerFor(to: string, delivered: readonly string[]): CardOwner {
	const label = delivered[0] ?? to;
	return { label };
}
