/**
 * The steps both card verbs take: one write, one message, and the two alarm reads.
 *
 * `assign` and `offer` differ in their order, and those differences stay in `tools.ts`, in the
 * function that owns each verb: `assign` resolves its peer from the roster *before* the write, so
 * one read names both the owner and the alarm clauses, where `offer` reads the roster *after* the
 * broadcast. What is here is the part the two do the same — and the one asymmetry that is
 * structural rather than passed, which is whether the notice's row owns a `told` half: that is what
 * lets `assign` settle its handoff and refuses to let `offer` settle a broadcast.
 *
 * Every step takes the verb's own sentence rather than guessing at a reason, so the words a lead
 * reads stay in `format.ts` with the rest of them, and a refusal still renders in the verb that
 * made it.
 *
 * Loaded from `execute`'s own `import()`, so `team`'s registration graph — and the budget it is
 * held to — never pays for it.
 */

import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { messageOf } from "../../lib/errors.ts";
import { type PeerRow, peersWithAlarm } from "../../lib/session-roster.ts";
import type { Deliver, DeliveryFailure } from "../../lib/session-tool.ts";
import type { ToolFailure } from "../../lib/tool-result.ts";
import type { Card } from "../../lib/workflow/card.ts";
import type { NoticeField } from "../../lib/workflow/contract.ts";
import { composeNotice, type NoticeContext, type NoticeKind, NOTICES } from "../../lib/workflow/notice.ts";
import type { Actor, CardOp } from "../../lib/workflow/rules.ts";
import type { BoardStore, MutateResult } from "../../lib/workflow/store.ts";
import type { TeamDetails } from "./types.ts";

/** One store write, keeping a throw rather than throwing it: the caller owns the half-applied case. */
async function writeOutcome(write: Promise<MutateResult>): Promise<{ result: MutateResult } | { thrown: unknown }> {
	try {
		return { result: await write };
	} catch (thrown) {
		return { thrown };
	}
}

/** One card write, and the two ways it fails. */
export interface WriteArgs {
	store: BoardStore;
	id: string;
	op: CardOp;
	me: Actor;
	now: number;
	/** The card as the verb read it, for a failure that names nothing newer. */
	card: Card;
	/** The verb's sentence for a write that threw or that a rule refused. */
	failure: (card: Card, reason: string) => ToolFailure<TeamDetails>;
}

/**
 * Write the card, and say what happened in the verb's own words.
 *
 * A throw and a refusal are the same fact to a reader — the card did not move, and nothing has been
 * sent — so both are answered with the verb's one sentence, carrying the card as it actually is:
 * the refusal's own card when the store handed one back, the read one otherwise.
 */
export async function writeCard(args: WriteArgs): Promise<{ card: Card } | ToolFailure<TeamDetails>> {
	const written = await writeOutcome(args.store.mutate(args.id, args.op, args.me, args.now));
	if ("thrown" in written) return args.failure(args.card, messageOf(written.thrown));
	const applied = written.result;
	if (!applied.ok) return args.failure(applied.card ?? args.card, applied.error);
	return { card: applied.card };
}

/** The message a card write owes, and where it goes. */
export interface NoticeSend {
	deliver: Deliver;
	ctx: ExtensionToolContext;
	notice: NoticeKind;
	/** The card as the write left it: the sentence is composed from the record the peer will read. */
	card: Card;
	/** The bus address: a peer's id-or-label, or `*` for the broadcast `offer` sends. */
	address: string;
	context: NoticeContext;
	/** The verb's sentence for a message the bus never took. */
	unsent: (card: Card, reason: string) => ToolFailure<TeamDetails>;
}

/**
 * Compose the notice, send it, and keep the two facts a result reports.
 *
 * The key is the notice's own — a card's clock, not this call's — so a repeat of the verb folds
 * into a copy still waiting rather than writing a second one. A send that came back wrote at least
 * one inbox, so `delivered` needs no fallback and a send that reached nobody is the failure here.
 */
export async function sendNotice(
	args: NoticeSend,
): Promise<{ delivered: string[]; failed: DeliveryFailure[] } | ToolFailure<TeamDetails>> {
	const notice = composeNotice(args.notice, args.card, args.context);
	try {
		const sent = await args.deliver.send(args.ctx, {
			kind: notice.kind,
			to: args.address,
			text: notice.text,
			key: notice.key,
			about: args.card.id,
		});
		if (!sent.ok) return args.unsent(args.card, sent.error);
		return { delivered: sent.delivered, failed: sent.failed };
	} catch (error) {
		return args.unsent(args.card, messageOf(error));
	}
}

/**
 * Whether the table owes this notice.
 *
 * The guarantee this predicate names: the only rows carrying a `told` half are the three
 * `NoticeField`s — the handoff and the two signs — so `NOTICES` and `TELL_FIELDS` describe one set
 * from its two sides.
 */
function isNoticeField(notice: NoticeKind): notice is NoticeField {
	return NOTICES[notice].told !== undefined;
}

/**
 * Record that the notice landed, when its row says one is owed, so the card stops owing it.
 *
 * This is the asymmetry between the two card verbs, and it is read from the table rather than
 * passed as a flag: `assign`'s row has a `told` half and settles, `offer`'s has none and cannot.
 * Only a send that landed reaches here, which is the other half of the same rule — a handoff nobody
 * heard must keep owing, so that a repeat of the verb is the retry.
 *
 * A write that fails is swallowed on purpose: the card keeps owing the announcement, which the
 * round lists and a repeat reads, so the failure costs a stale row rather than a lost handoff.
 */
export async function settleNotice(
	store: BoardStore,
	id: string,
	notice: NoticeKind,
	me: Actor,
	now: number,
): Promise<void> {
	if (!isNoticeField(notice)) return;
	await store.mutate(id, { kind: "announced", notice }, me, now).catch(() => undefined);
}

/** The two alarms a delivered message carries, from one read of the roster. */
export function alarmLines(
	peers: readonly PeerRow[] | undefined,
	delivered: readonly string[],
): { silent: string[]; still: string[] } {
	return {
		silent: peersWithAlarm(peers, delivered, "not-listening"),
		still: peersWithAlarm(peers, delivered, "quiet"),
	};
}

/**
 * The three alarm fields, present only when they have something to say.
 *
 * A result's shape is a fact the renderer and the branch both read, so an empty list is left out
 * rather than written as `[]`: "no peer was quiet" and "the roster could not say" must not render
 * alike.
 */
export function alarmFields(
	silent: readonly string[],
	still: readonly string[],
	failed: readonly DeliveryFailure[],
): Pick<TeamDetails, "failed" | "notListening" | "quiet"> {
	return {
		...(failed.length === 0 ? {} : { failed: [...failed] }),
		...(silent.length === 0 ? {} : { notListening: [...silent] }),
		...(still.length === 0 ? {} : { quiet: [...still] }),
	};
}
