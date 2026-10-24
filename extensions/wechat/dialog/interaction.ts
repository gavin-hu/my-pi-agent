/**
 * The WeChat implementation of {@link InteractionChannel}: it forwards a dialog
 * prompt to the peer that owns the current turn and resolves when that peer
 * replies.
 *
 * It depends only on injected `send`/`sendFile`/`activePeer` accessors and a
 * timer seam, never on the bridge or HTTP client, so it is unit-tested without
 * I/O. The bridge owns the poll loop and hands each inbound message to
 * {@link WechatInteractionChannel.handleInbound}.
 *
 * A prompt is bounded: a peer who never answers cannot hold the session open, so
 * a reminder goes out halfway and the dialog is cancelled with a short line at
 * {@link PROMPT_TIMEOUT_MS}.
 */

import {
	INTERACTION_OTHER_LABEL,
	type InteractionAnswer,
	type InteractionChannel,
	type InteractionRequest,
} from "../../../lib/interaction.ts";
import { type PeerLanguage } from "../text/format.ts";
import { notice } from "../text/notices.ts";
import { formatPrompt, parsePromptAnswer } from "./prompt.ts";
import { defaultTimer, type ArmTimer } from "../timer.ts";

/** How long a forwarded prompt waits before it is cancelled. */
export const PROMPT_TIMEOUT_MS = 180_000;

export interface WechatInteractionDeps {
	/** Send one text message to the owning peer; `force` bypasses the prompt-active gate. */
	send: (text: string, signal?: AbortSignal, options?: { force?: boolean }) => Promise<boolean>;
	/** Send a local file to the owning peer; `force` bypasses the prompt-active gate. */
	sendFile: (path: string, name: string, signal?: AbortSignal, options?: { force?: boolean }) => Promise<boolean>;
	/** The peer that owns the in-flight turn, or undefined when there is none. */
	activePeer: () => string | undefined;
	/** The language the owning peer writes in, for the timeout notices. */
	language: () => PeerLanguage;
	/** Arm a cancellable one-shot timer. Defaults to a real, unref'd `setTimeout`. */
	armTimer?: ArmTimer;
	/** Clock for the prompt's start time; defaults to `Date.now`. */
	now?: () => number;
}

export interface WechatInteractionChannel extends InteractionChannel {
	/**
	 * Widen the bound for the prompts asked inside the scope, and restore the
	 * previous one when it ends: the optional channel member, made concrete here.
	 */
	setPromptTimeout(ms: number): () => void;
	/** Consume an inbound message as a reply; true when it was one. */
	handleInbound(peer: string, text: string): boolean;
	/** Whether a prompt is currently waiting for a reply. */
	hasPending(): boolean;
	/** The waiting prompt, for the control screen; undefined when none waits. */
	pendingInfo(): PendingPromptInfo | undefined;
	/** Withdraw the waiting prompt: tell the peer and resolve it cancelled. */
	cancel(): Promise<void>;
	/** The language prompts are rendered in. */
	language(): PeerLanguage;
	/** Drop any pending prompt (turn settled or the bridge stopped). */
	reset(): void;
}

/** The waiting prompt, as the control screen reads it. */
export interface PendingPromptInfo {
	peer: string;
	kind: InteractionRequest["kind"];
	title: string;
	/** When the prompt was registered, in epoch milliseconds. */
	startedAt: number;
}

interface Pending {
	request: InteractionRequest;
	peer: string;
	startedAt: number;
	resolve: (answer: InteractionAnswer) => void;
	signal?: AbortSignal;
	onAbort: () => void;
	/** Cancellers for the reminder and the expiry timer. */
	cancelTimers: Array<() => void>;
}

export function createWechatInteractionChannel(deps: WechatInteractionDeps): WechatInteractionChannel {
	const arm = deps.armTimer ?? defaultTimer;
	const now = deps.now ?? Date.now;
	let pending: Pending | undefined;
	/**
	 * The bound for the prompts asked inside the current `setPromptTimeout` scope,
	 * set by a caller whose dialog needs reading time before it can be answered.
	 */
	let scopedTimeoutMs: number | undefined;
	/**
	 * Free text captured from a `select` "Other" reply, per peer: the immediately
	 * following `input` for that peer returns it. Keyed so one peer's free text can
	 * never become another peer's answer.
	 */
	const other = new Map<string, string>();

	function settle(answer: InteractionAnswer): void {
		const current = pending;
		if (!current) return;
		pending = undefined;
		for (const cancel of current.cancelTimers) cancel();
		current.cancelTimers = [];
		current.signal?.removeEventListener("abort", current.onAbort);
		current.resolve(answer);
	}

	return {
		isActive(): boolean {
			return deps.activePeer() !== undefined;
		},

		language(): PeerLanguage {
			return deps.language();
		},

		hasPending(): boolean {
			return pending !== undefined;
		},

		pendingInfo(): PendingPromptInfo | undefined {
			const current = pending;
			return current === undefined
				? undefined
				: {
						peer: current.peer,
						kind: current.request.kind,
						title: current.request.title,
						startedAt: current.startedAt,
					};
		},

		async cancel(): Promise<void> {
			const current = pending;
			if (!current) return;
			// The peer saw the prompt; one line says it was withdrawn, which is not the
			// same as expiry — they were not slow, the question went away. `reset` is the
			// silent cleanup path and deliberately does not send this. Settle after the
			// notice is on the wire, so a caller awaiting the answer knows it was sent.
			try {
				await deps.send(notice("withdrawn", deps.language()), undefined, { force: true });
			} finally {
				if (pending === current) settle({ kind: "cancelled" });
			}
		},

		async post(text: string, signal?: AbortSignal): Promise<void> {
			await deps.send(text, signal, { force: true });
		},

		async postFile(path: string, name: string, signal?: AbortSignal): Promise<boolean> {
			return deps.sendFile(path, name, signal, { force: true });
		},

		setPromptTimeout(ms: number): () => void {
			const previous = scopedTimeoutMs;
			scopedTimeoutMs = ms;
			return () => {
				scopedTimeoutMs = previous;
			};
		},

		async request(request: InteractionRequest, signal?: AbortSignal): Promise<InteractionAnswer> {
			// A `select` that resolved to "Other" stashes its text for that peer; the
			// immediately following `input` from the same peer returns it without
			// another round-trip.
			const asking = deps.activePeer();
			const stashed = asking === undefined ? undefined : other.get(asking);
			if (request.kind === "input" && asking !== undefined && stashed !== undefined) {
				other.delete(asking);
				return { kind: "value", value: stashed };
			}
			if (request.kind !== "input" && asking !== undefined) other.delete(asking);

			if (signal?.aborted || !this.isActive()) return { kind: "cancelled" };
			if (pending) return { kind: "cancelled" };

			// Register the pending prompt before the send await so a fast reply is
			// never lost to the round-trip, then send and fail closed.
			const peer = deps.activePeer() as string;
			const cancelTimers: Array<() => void> = [];
			const answer = new Promise<InteractionAnswer>((resolve) => {
				const onAbort = () => settle({ kind: "cancelled" });
				pending = { request, peer, startedAt: now(), resolve, signal, onAbort, cancelTimers };
				signal?.addEventListener("abort", onAbort, { once: true });
				// An ignored question must not freeze the session: nudge once, then
				// cancel so the model gets a clean answer instead of a hang.
				const bound = scopedTimeoutMs ?? PROMPT_TIMEOUT_MS;
				cancelTimers.push(
					arm(bound / 2, () => void deps.send(notice("promptWaiting", deps.language()), undefined, { force: true })),
				);
				cancelTimers.push(
					arm(bound, () => {
						void deps.send(notice("timeout", deps.language()), undefined, { force: true });
						settle({ kind: "cancelled" });
					}),
				);
			});
			const sent = await deps.send(formatPrompt(request, { language: deps.language() }), signal);
			if (!sent) settle({ kind: "cancelled" });
			return await answer;
		},

		handleInbound(peer: string, text: string): boolean {
			const current = pending;
			if (!current || current.peer !== peer) return false;
			const parsed = parsePromptAnswer(current.request, text);
			switch (parsed.kind) {
				case "retry":
					void deps.send(formatPrompt(current.request, { retry: true, language: deps.language() }), undefined, {
						force: true,
					});
					return true;
				case "other":
					other.set(peer, parsed.text);
					settle({ kind: "value", value: INTERACTION_OTHER_LABEL });
					return true;
				case "value":
					settle({ kind: "value", value: parsed.value });
					return true;
				case "confirmed":
					settle({ kind: "confirmed", confirmed: parsed.confirmed });
					return true;
				case "cancelled":
					settle({ kind: "cancelled" });
					return true;
			}
		},

		reset(): void {
			other.clear();
			scopedTimeoutMs = undefined;
			settle({ kind: "cancelled" });
		},
	};
}
