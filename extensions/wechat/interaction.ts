/**
 * The WeChat implementation of {@link InteractionChannel}: it forwards a dialog
 * prompt to the peer that owns the current turn and resolves when that peer
 * replies.
 *
 * It depends only on an injected `send` and an `activePeer` accessor, never on
 * the bridge or HTTP client, so it is unit-tested without I/O. The bridge owns
 * the poll loop and hands each inbound message to {@link WechatInteractionChannel.handleInbound}.
 */

import {
	INTERACTION_OTHER_LABEL,
	type InteractionAnswer,
	type InteractionChannel,
	type InteractionRequest,
} from "../../lib/interaction.ts";
import { formatPrompt, parsePromptAnswer } from "./prompt.ts";

export interface WechatInteractionDeps {
	/** Send one text message to the owning peer; resolves false when it fails. */
	send: (text: string, signal?: AbortSignal) => Promise<boolean>;
	/** Send a local file to the owning peer; resolves false when it fails. */
	sendFile: (path: string, name: string, signal?: AbortSignal) => Promise<boolean>;
	/** The peer that owns the in-flight turn, or undefined when there is none. */
	activePeer: () => string | undefined;
}

export interface WechatInteractionChannel extends InteractionChannel {
	/** Consume an inbound message as a reply; true when it was one. */
	handleInbound(peer: string, text: string): boolean;
	/** Whether a prompt is currently waiting for a reply. */
	hasPending(): boolean;
	/** Drop any pending prompt (turn settled or the bridge stopped). */
	reset(): void;
}

interface Pending {
	request: InteractionRequest;
	peer: string;
	resolve: (answer: InteractionAnswer) => void;
	signal?: AbortSignal;
	onAbort: () => void;
}

export function createWechatInteractionChannel(deps: WechatInteractionDeps): WechatInteractionChannel {
	let pending: Pending | undefined;
	/** Free text captured from a `select` "Other" reply, for the next `input`. */
	let other: string | undefined;

	function settle(answer: InteractionAnswer): void {
		const current = pending;
		if (!current) return;
		pending = undefined;
		current.signal?.removeEventListener("abort", current.onAbort);
		current.resolve(answer);
	}

	return {
		isActive(): boolean {
			return deps.activePeer() !== undefined;
		},

		hasPending(): boolean {
			return pending !== undefined;
		},

		async post(text: string, signal?: AbortSignal): Promise<void> {
			await deps.send(text, signal);
		},

		async postFile(path: string, name: string, signal?: AbortSignal): Promise<boolean> {
			return deps.sendFile(path, name, signal);
		},

		async request(request: InteractionRequest, signal?: AbortSignal): Promise<InteractionAnswer> {
			// A `select` that resolved to "Other" stashes its text; the immediately
			// following `input` returns it without another round-trip.
			if (request.kind === "input" && other !== undefined) {
				const value = other;
				other = undefined;
				return { kind: "value", value };
			}
			if (request.kind !== "input") other = undefined;

			if (signal?.aborted || !this.isActive()) return { kind: "cancelled" };
			if (pending) return { kind: "cancelled" };

			// Register the pending prompt before the send await so a fast reply is
			// never lost to the round-trip, then send and fail closed.
			const peer = deps.activePeer() as string;
			const answer = new Promise<InteractionAnswer>((resolve) => {
				const onAbort = () => settle({ kind: "cancelled" });
				pending = { request, peer, resolve, signal, onAbort };
				signal?.addEventListener("abort", onAbort, { once: true });
			});
			const sent = await deps.send(formatPrompt(request), signal);
			if (!sent) settle({ kind: "cancelled" });
			return await answer;
		},

		handleInbound(peer: string, text: string): boolean {
			const current = pending;
			if (!current || current.peer !== peer) return false;
			const parsed = parsePromptAnswer(current.request, text);
			switch (parsed.kind) {
				case "retry":
					void deps.send(formatPrompt(current.request));
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
			settle({ kind: "cancelled" });
		},
	};
}
