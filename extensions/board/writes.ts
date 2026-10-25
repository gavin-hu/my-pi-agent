/**
 * The page's write path: one request from a browser, one call into the store.
 *
 * A browser is not an identity, so every write here is made as the actor the page
 * serves as — the session that started it, until a page has a seat. Two statuses matter
 * to a client that retries: a field it can fix is 422, and a card somebody else moved is
 * 409 with the card as it now stands. Everything else about a card's lifecycle is
 * `lib/board/rules.ts`.
 */

import { normalizeCardId } from "../../lib/board/card.ts";
import type { Actor, CardOp } from "../../lib/board/rules.ts";
import type { BoardStore } from "../../lib/board/store.ts";
import { normalizeLabel } from "../../lib/session-label.ts";
import { createInput } from "./input.ts";
import type { PageResult, PageWrite } from "./transport/router.ts";

/** What a write needs: the store, who it is made as, and the clock. */
export interface WriteContext {
	store: BoardStore;
	actor: () => Actor;
	now: () => number;
}

/** One write, with the status the page shows as a banner. */
export async function writeOf(context: WriteContext, request: PageWrite): Promise<PageResult> {
	const me = context.actor();
	if (request.kind === "add") {
		const parsed = createInput(request.body);
		if ("error" in parsed) return { ok: false, status: 422, error: parsed.error };
		const card = await context.store.create(parsed.input, me, context.now());
		return { ok: true, card };
	}

	const id = normalizeCardId(request.id);
	if (id === undefined) return { ok: false, status: 422, error: `"${request.id}" is not a card id.` };
	const op = opOf(request);
	if ("error" in op) return { ok: false, status: 422, error: op.error };
	const result = await context.store.mutate(id, op.op, me, context.now());
	if (!result.ok)
		return {
			ok: false,
			status: 409,
			error: result.error,
			...(result.card === undefined ? {} : { card: result.card }),
		};
	return { ok: true, card: result.card };
}

/** The operation a card route names, or the reason it cannot be one. */
export function opOf(request: PageWrite): { op: CardOp } | { error: string } {
	switch (request.kind) {
		case "claim":
			return { op: { kind: "claim" } };
		case "release":
			return { op: { kind: "release" } };
		case "reclaim":
			return { op: { kind: "reclaim" } };
		case "assign": {
			// A page cannot message a peer — a command context has no tool calls — so this
			// records the owner and says in the card's history that nothing was sent.
			const to = normalizeLabel(typeof request.body.to === "string" ? request.body.to : "", "");
			if (to === "") return { error: "assign needs a teammate to hand the card to." };
			return {
				op: {
					kind: "assign",
					to: { label: to },
					note: `assigned to ${to} from the board page; no handoff was sent`,
				},
			};
		}
		case "drop":
			return { op: { kind: "drop" } };
		case "note":
			return { op: { kind: "note", text: request.body.text } };
		case "plan":
			return { op: { kind: "plan", path: request.body.path } };
		case "edit":
			// Every field is passed through as the browser sent it, including the absent
			// ones: `applyOp` leaves an absent field alone, which is what keeps the page
			// from clearing a link it never showed.
			return {
				op: {
					kind: "edit",
					title: request.body.title,
					paths: request.body.paths,
					priority: request.body.priority,
					dependsOn: request.body.dependsOn,
				},
			};
		case "move": {
			const status = request.body.status;
			if (status === "doing" || status === "blocked" || status === "done") return { op: { kind: "move", status } };
			return { error: 'move needs a target lane: "doing", "blocked", or "done".' };
		}
		default:
			return { error: "add is not a card route." };
	}
}
