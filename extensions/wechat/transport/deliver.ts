/**
 * Every outbound WeChat message goes through here: a reply, a dialog preface, a
 * file, and the owner-only `send_wechat` tool.
 *
 * The path is shared so Markdown flattening, part numbering, session expiry,
 * body-level rejection, and partial progress are decided once. A failure is
 * reported once per peer until a send gets through, and the peer's stored reply
 * token is forgotten so the next inbound message can replace it.
 */

import type { BotCredentials } from "../types.ts";
import { isSessionExpired, rejectionOf, WechatError, type WechatClient } from "./client.ts";
import { messageOf } from "../errors.ts";
import { chunkText, toWechatText } from "../text/format.ts";
import { sendLocalFile } from "./outbound.ts";

/** One addressed text destination. */
export interface MessageTarget {
	peer: string;
	contextToken?: string;
}

/** The outcome of one outbound text delivery attempt. */
export interface Delivery {
	ok: boolean;
	/** Parts the transport accepted before stopping. */
	sent: number;
	total: number;
	/** The server reported an expired token; the caller has been notified. */
	expired?: boolean;
	/** Formatting left nothing to send. */
	empty?: boolean;
}

/** The owner-send result shape `send_wechat` returns. */
export interface DeliveryResult {
	ok: boolean;
	error?: string;
}

/** What the deliverer needs from the bridge; all state is read at call time. */
export interface DeliveryDeps {
	client: () => WechatClient | undefined;
	account: () => BotCredentials | undefined;
	maxReplyChars: () => number;
	cdnBaseUrl: string;
	maxMediaBytes: number;
	notify: (message: string, kind?: "info" | "warning" | "error") => void;
	onExpired: () => void;
	/** Drop a peer's cached reply token. */
	forgetToken: (peer: string) => void;
	/** The last send failure, for the doctor/status. */
	onSendError?: (message: string) => void;
	/** A message got through; clear the last failure. */
	onSent?: () => void;
}

/** The bridge's outbound surface. */
export interface Deliverer {
	/** Send a reply to a peer; false when the transport rejected it. */
	reply(target: MessageTarget, text: string, signal?: AbortSignal): Promise<boolean>;
	/** Send a prompt to a peer. */
	prompt(target: MessageTarget, text: string, signal?: AbortSignal): Promise<boolean>;
	/** Upload and send a local file to a peer. */
	file(target: MessageTarget, filePath: string, fileName: string, signal?: AbortSignal): Promise<boolean>;
	/** Message the owner; returns the tool's result instead of logging. */
	toOwner(owner: string, contextToken: string | undefined, text: string, signal?: AbortSignal): Promise<DeliveryResult>;
	/** Forget the one-notice-per-outage state (a new connection). */
	reset(): void;
}

export function createDeliverer(deps: DeliveryDeps): Deliverer {
	/** Peers already reported as unable to receive, until a send gets through. */
	const failureNotified = new Set<string>();
	/** Per-peer FIFO: a reply, prompt, or file cannot start before the previous one. */
	const queues = new Map<string, Promise<void>>();

	function serialize<T>(peer: string, work: () => Promise<T>): Promise<T> {
		const previous = queues.get(peer) ?? Promise.resolve();
		const run = previous.then(work, work);
		const settled = run.then(
			() => undefined,
			() => undefined,
		);
		queues.set(peer, settled);
		void settled.finally(() => {
			if (queues.get(peer) === settled) queues.delete(peer);
		});
		return run;
	}

	/**
	 * Send `text` in `maxReplyChars` chunks, stopping at the first failed chunk.
	 * A session expiry is handled here; a transport or rejection error is handed to
	 * `onFailure` with how much went out, so each caller reports it its own way.
	 */
	async function deliverText(
		to: string,
		contextToken: string | undefined,
		text: string,
		signal: AbortSignal | undefined,
		onFailure: (error: unknown, progress: { sent: number; total: number }) => void,
	): Promise<Delivery> {
		const client = deps.client();
		const account = deps.account();
		if (!client || !account) return { ok: false, sent: 0, total: 0 };
		const chunks = chunkText(toWechatText(text), deps.maxReplyChars()).filter((chunk) => chunk !== "");
		if (chunks.length === 0) {
			deps.notify("WeChat message had nothing to send after formatting.", "warning");
			return { ok: false, sent: 0, total: 0, empty: true };
		}
		for (const [index, chunk] of chunks.entries()) {
			// A split answer says so, so the peer knows more is coming and can tell a
			// truncated reply from a complete one.
			const body = chunks.length > 1 ? `[${index + 1}/${chunks.length}] ${chunk}` : chunk;
			try {
				const response = await client.sendMessage(account, { to, text: body, contextToken }, signal);
				if (isSessionExpired(response)) {
					deps.onExpired();
					return { ok: false, sent: index, total: chunks.length, expired: true };
				}
				// A body-level rejection is not a delivery: report it with the part count
				// instead of letting the answer vanish.
				const rejection = rejectionOf(response);
				if (rejection) {
					const detail = rejection.detail ? `: ${rejection.detail}` : "";
					onFailure(new WechatError(`Weixin rejected the message (ret ${rejection.code}${detail}).`), {
						sent: index,
						total: chunks.length,
					});
					return { ok: false, sent: index, total: chunks.length };
				}
			} catch (error) {
				onFailure(error, { sent: index, total: chunks.length });
				return { ok: false, sent: index, total: chunks.length };
			}
		}
		return { ok: true, sent: chunks.length, total: chunks.length };
	}

	/** Report a failure once per outage, forget the token, and return the outcome. */
	async function deliverWithNotice(
		target: MessageTarget,
		text: string,
		label: "reply" | "message delivery",
		signal: AbortSignal | undefined,
	): Promise<boolean> {
		let failed = false;
		const delivery = await deliverText(target.peer, target.contextToken, text, signal, (error, progress) => {
			failed = true;
			if (signal?.aborted) return;
			deps.forgetToken(target.peer);
			if (failureNotified.has(target.peer)) return;
			failureNotified.add(target.peer);
			const partial = progress.total > 1 ? ` after ${progress.sent} of ${progress.total} parts were sent` : "";
			deps.onSendError?.(messageOf(error));
			deps.notify(`WeChat ${label} failed${partial}: ${messageOf(error)}`, "warning");
		});
		if (!failed && delivery.ok) {
			failureNotified.delete(target.peer);
			deps.onSent?.();
		}
		return delivery.ok;
	}

	return {
		reply(target, text, signal) {
			return serialize(target.peer, () => deliverWithNotice(target, text, "reply", signal));
		},

		prompt(target, text, signal) {
			return serialize(target.peer, () => deliverWithNotice(target, text, "message delivery", signal));
		},

		file(target, filePath, fileName, signal) {
			return serialize(target.peer, async () => {
				const client = deps.client();
				const account = deps.account();
				if (!client || !account) return false;
				const sent = await sendLocalFile({
					client,
					account,
					cdnBaseUrl: deps.cdnBaseUrl,
					maxBytes: deps.maxMediaBytes,
					to: target.peer,
					contextToken: target.contextToken,
					filePath,
					fileName,
					signal,
				});
				// `sendLocalFile` reports only success, and the caller may fall back to text;
				// without this line the operator would never know the attachment was dropped.
				if (!sent && !signal?.aborted) {
					deps.onSendError?.(`file delivery failed: ${fileName}`);
					deps.notify(`WeChat file delivery failed for ${fileName}.`, "warning");
				}
				if (sent) deps.onSent?.();
				return sent;
			});
		},

		toOwner(owner, contextToken, text, signal) {
			return serialize(owner, async () => {
				let failure: string | undefined;
				const delivery = await deliverText(owner, contextToken, text, signal, (error, progress) => {
					deps.forgetToken(owner);
					const partial = progress.total > 1 ? ` after ${progress.sent} of ${progress.total} parts were sent` : "";
					deps.onSendError?.(messageOf(error));
					failure = `${messageOf(error)}${partial}`;
				});
				if (delivery.expired) return { ok: false, error: "WeChat session expired." };
				if (delivery.empty) return { ok: false, error: "Nothing to send after formatting." };
				if (!delivery.ok) return { ok: false, error: failure ?? "WeChat send failed." };
				deps.onSent?.();
				return { ok: true };
			});
		},

		reset() {
			failureNotified.clear();
		},
	};
}
