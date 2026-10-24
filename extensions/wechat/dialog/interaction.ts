/**
 * The WeChat implementation of {@link InteractionChannel}: it forwards a dialog
 * prompt to one peer and resolves when that peer replies.
 *
 * One channel serves one peer. That is what lets two peers' turns run at once
 * without a dialog becoming ambiguous: the channel knows who it is asking, so a
 * reply can only answer its own peer's prompt. It depends only on injected
 * `send`/`sendFile`/`active` accessors and a timer seam, never on the bridge or
 * HTTP client, so it is unit-tested without I/O. The bridge owns the poll loop,
 * keeps one channel per peer (`channels.ts`), and hands each inbound message to
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
	/** The one peer this channel asks. */
	peer: string;
	/** Send one text message to the peer; `force` bypasses the prompt-active gate. */
	send: (text: string, signal?: AbortSignal, options?: { force?: boolean }) => Promise<boolean>;
	/** Send a local file to the peer; `force` bypasses the prompt-active gate. */
	sendFile: (path: string, name: string, signal?: AbortSignal, options?: { force?: boolean }) => Promise<boolean>;
	/** Whether the peer owns a turn right now, so a prompt has somewhere to land. */
	active: () => boolean;
	/** The language the peer writes in, for the timeout notices. */
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
	/** Consume an inbound message as a reply to this peer's prompt. */
	handleInbound(text: string): boolean;
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
	 * Free text captured from a `select` "Other" reply: the immediately following
	 * `input` for this peer returns it. One value, because one channel asks one peer
	 * — another peer's free text cannot reach this channel at all.
	 */
	let other: string | undefined;

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
			return deps.active();
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
						peer: deps.peer,
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
			// A `select` that resolved to "Other" stashes its text; the immediately
			// following `input` returns it without another round-trip.
			const stashed = other;
			if (request.kind === "input" && stashed !== undefined) {
				other = undefined;
				return { kind: "value", value: stashed };
			}
			if (request.kind !== "input") other = undefined;

			if (signal?.aborted || !this.isActive()) return { kind: "cancelled" };
			if (pending) return { kind: "cancelled" };

			// Register the pending prompt before the send await so a fast reply is
			// never lost to the round-trip, then send and fail closed.
			const cancelTimers: Array<() => void> = [];
			const answer = new Promise<InteractionAnswer>((resolve) => {
				const onAbort = () => settle({ kind: "cancelled" });
				pending = { request, startedAt: now(), resolve, signal, onAbort, cancelTimers };
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

		handleInbound(text: string): boolean {
			const current = pending;
			if (!current) return false;
			const parsed = parsePromptAnswer(current.request, text);
			switch (parsed.kind) {
				case "retry":
					void deps.send(formatPrompt(current.request, { retry: true, language: deps.language() }), undefined, {
						force: true,
					});
					return true;
				case "other":
					other = parsed.text;
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
			other = undefined;
			scopedTimeoutMs = undefined;
			settle({ kind: "cancelled" });
		},
	};
}
