/**
 * The chat session: the host Pi session, answering the WeChat owner.
 *
 * There is one conversation, and it is this session's. An inbound message is a
 * user turn started here with `sendUserMessage`, its deltas are relayed to the
 * phone as they arrive, and the run's settle is what ends the turn — so the chat
 * and the terminal share one transcript, one model, and one set of tools.
 *
 * Three contract points live here:
 *
 * - The turn takes over `ctx.ui`'s four dialogs while it runs: `markRemoteTurn`
 *   answers them through the chat's channel and marks it (`INTERACTION_TURN_KEY`),
 *   which is how a prompt raised inside the turn — a `question`, a plan review,
 *   `plan` `enter`'s confirm — reaches the phone instead of a terminal nobody is
 *   watching. A terminal turn is not marked, so its dialogs stay local.
 * - The phone-chat contract is appended to the system prompt for those turns
 *   only, through `before_agent_start` (see `index.ts`); the terminal's turns are
 *   not told they are answering on a phone.
 * - A prompt waits for the session to be idle before it starts: `sendUserMessage`
 *   refuses to start a turn while one is streaming, and a WeChat message must not
 *   be lost to a terminal run. `deliverAs` is not used — see `waitForIdle`.
 *
 * The session surface is the one the worker already drives (`prompt`, `abort`,
 * `subscribe`, `getLastAssistantText`), so the queue, the reply pipeline, and the
 * notices stay where they are and this file replaces only the fabricated session.
 */

import type { ImageContent } from "@earendil-works/pi-ai";
import { markRemoteTurn, type InteractionChannel } from "../../../lib/interaction.ts";
import { asRecord } from "../../../lib/json.ts";

/** The session surface one WeChat turn drives. */
export interface ChatSession {
	/** Run one turn with this text and images; resolves when the run settles. */
	prompt(text: string, options?: { images?: ImageContent[] }): Promise<void>;
	/** Abort the running turn, or cancel a prompt still waiting for the session. */
	abort(): void;
	/** Subscribe to the deltas and the compaction the reply path reads. */
	subscribe(listener: (event: ChatSessionEvent) => void): () => void;
	/** The last assistant text of the turn, for a provider that does not stream. */
	getLastAssistantText(): string;
}

/** What a turn reports: the same two events the reply path reads from an SDK session. */
export type ChatSessionEvent =
	| { type: "message_update"; assistantMessageEvent: { type: "text_delta"; delta: string } }
	| { type: "compaction_end"; aborted: boolean };

/** A turn of the host session, held open until its run settles. */
export interface ChatTurn {
	session: ChatSession;
	/** Stop listening to the host's events; the session itself outlives the bridge. */
	dispose(): Promise<void>;
}

/** The host events this file listens to; the names are Pi's own. */
export type HostEventName = "message_update" | "turn_end" | "agent_settled" | "session_compact";

/** Register a host event handler and return the unsubscribe. */
export type SubscribeHostEvent = (event: HostEventName, handler: (payload: unknown) => void) => () => void;

export interface HostChatDeps {
	/** Start a user turn in the host session (Pi's `sendUserMessage`). */
	sendUserMessage: (content: string | Array<TextPart | ImageContent>) => void;
	/** Whether the host session is free to start one. */
	isIdle: () => boolean;
	/** Abort the host session's running turn (Pi's `ctx.abort`). */
	abortTurn: () => void;
	/** The host UI context object: the turn is marked on it for `askHuman`. */
	ui: Record<string, unknown>;
	/** The channel the chat's dialogs are answered through. */
	channel: (peer: string) => InteractionChannel;
	/** Register a host event handler; defaults to nothing, which relays no deltas. */
	subscribe?: SubscribeHostEvent;
	/** A turn that failed in a way worth showing on the terminal. */
	notify?: (message: string, kind?: "info" | "warning" | "error") => void;
}

/** A text part of a user message. */
export interface TextPart {
	type: "text";
	text: string;
}

/**
 * Open the host session as the chat's session.
 *
 * `peer` is the sender whose channel answers this turn's dialogs — the account's
 * owner, the one conversation there is.
 */
export function openChatTurn(peer: string, deps: HostChatDeps): ChatTurn {
	const listeners = new Set<(event: ChatSessionEvent) => void>();
	/** The turn in flight, or undefined while the session is free. */
	let turn: { resolve: () => void; reject: (error: Error) => void } | undefined;
	/** Prompts held back because the terminal was mid-run; resolved on its settle. */
	let waiters: Array<() => void> = [];
	/** The caller asked to stop before the turn could start. */
	let cancelled = false;
	let lastText = "";
	let disposed = false;

	function emit(event: ChatSessionEvent): void {
		for (const listener of listeners) listener(event);
	}

	/** Undo for the dialogs this turn took over, while it runs. */
	let restoreDialogs: (() => void) | undefined;

	/**
	 * Take the turn's dialogs over. Best-effort per member: a context that refuses a
	 * write leaves that dialog local, which is what a session with no UI needs.
	 */
	function mark(): void {
		restoreDialogs = markRemoteTurn(deps.ui, deps.channel(peer));
	}

	function unmark(): void {
		restoreDialogs?.();
		restoreDialogs = undefined;
	}

	/** Release the prompts waiting for an idle session. */
	function release(): void {
		const held = waiters;
		waiters = [];
		for (const resolve of held) resolve();
	}

	const unsubscribes = [
		(deps.subscribe ?? (() => () => {}))("message_update", (payload) => {
			if (!turn) return;
			const delta = textDeltaOf(payload);
			if (delta !== undefined) emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta } });
		}),
		(deps.subscribe ?? (() => () => {}))("session_compact", () => {
			// The chat's context was compacted, so its earlier detail is fuzzy now.
			if (turn) emit({ type: "compaction_end", aborted: false });
		}),
		(deps.subscribe ?? (() => () => {}))("turn_end", (payload) => {
			if (!turn) return;
			lastText = textOfPayload(payload) ?? lastText;
		}),
		(deps.subscribe ?? (() => () => {}))("agent_settled", (payload) => {
			const current = turn;
			if (!current) {
				// The terminal's run ended: a prompt that was waiting may start now.
				release();
				return;
			}
			turn = undefined;
			unmark();
			if (abortedOf(payload) || cancelled) current.reject(new Error("WeChat turn aborted"));
			else current.resolve();
		}),
	];

	/**
	 * Wait for the host session to be free, or give up because the turn was stopped.
	 *
	 * The alternative is `sendUserMessage(..., { deliverAs: "followUp" })`, which
	 * injects the chat's message into the terminal's run. It is rejected here for one
	 * reason: the deltas are relayed from the moment the chat's turn is marked, so a
	 * follow-up injected mid-run would stream the rest of the *terminal's* answer to
	 * the phone. Waiting costs a delay on a busy terminal and keeps the relay honest:
	 * everything the phone receives belongs to its own turn.
	 */
	async function waitForIdle(): Promise<void> {
		while (!deps.isIdle() && !cancelled) {
			await new Promise<void>((resolve) => waiters.push(resolve));
		}
	}

	return {
		session: {
			async prompt(text, options) {
				lastText = "";
				cancelled = false;
				await waitForIdle();
				if (cancelled) throw new Error("WeChat turn aborted");
				const images = options?.images ?? [];
				const content: string | Array<TextPart | ImageContent> =
					images.length === 0 ? text : [{ type: "text", text }, ...images];
				const settled = new Promise<void>((resolve, reject) => {
					turn = { resolve, reject };
				});
				mark();
				try {
					deps.sendUserMessage(content);
				} catch (error) {
					turn = undefined;
					unmark();
					throw error;
				}
				await settled;
			},

			abort() {
				cancelled = true;
				if (turn) deps.abortTurn();
				release();
			},

			subscribe(listener) {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},

			getLastAssistantText() {
				return lastText;
			},
		},

		async dispose() {
			if (disposed) return;
			disposed = true;
			listeners.clear();
			unmark();
			// A prompt still held for an idle session must not resolve into a disposed
			// caller: the worker's close awaits this, so the wait ends here.
			cancelled = true;
			release();
			for (const unsubscribe of unsubscribes) unsubscribe();
		},
	};
}

/** The text one `message_update` carried, when it was a delta. */
function textDeltaOf(payload: unknown): string | undefined {
	const event = asRecord(payload);
	const assistant = asRecord(event?.assistantMessageEvent);
	return assistant?.type === "text_delta" && typeof assistant.delta === "string" ? assistant.delta : undefined;
}

/** Whether a settle payload says the run was aborted. */
function abortedOf(payload: unknown): boolean {
	return asRecord(payload)?.aborted === true;
}

/** The text of the message a payload carries, when it carries one. */
function textOfPayload(payload: unknown): string | undefined {
	const content = asRecord(asRecord(payload)?.message)?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return undefined;
	const parts = content
		.map((part) => asRecord(part))
		.filter((part): part is Record<string, unknown> => part !== undefined && part.type === "text")
		.map((part) => (typeof part.text === "string" ? part.text : ""));
	return parts.join("") || undefined;
}
