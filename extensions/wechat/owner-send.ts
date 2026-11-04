/**
 * The owner-bound proactive send behind `send_wechat`: one text, one image, or one
 * file, and never a chosen recipient.
 *
 * The field names the shape, not the bytes: `image` is a picture and screens its
 * bytes for one, `file` is a document however the bytes would sniff, and `text` is
 * a bubble a running turn would duplicate. The bridge reads the live target and the
 * connection state, so nothing here touches a client.
 */

import { basename } from "node:path";
import type { Deliverer, MessageTarget } from "./transport/deliver.ts";
import { sanitizeInbound } from "./text/format.ts";

/** One owner-bound send: the field chosen is the shape the owner receives. */
export type OwnerMessage = { text: string } | { image: string } | { file: string };

/** The owner-send result shape `send_wechat` returns. */
export interface SendResult {
	ok: boolean;
	error?: string;
}

/** What one send needs from the bridge; the connection is checked before this is called. */
export interface OwnerSendDeps {
	/** The owner's chat and stored reply token. */
	target: MessageTarget;
	deliverer: Deliverer;
	/** The connection's abort signal, so a stop abandons the upload. */
	signal: () => AbortSignal | undefined;
	/** Whether the owner's own turn is running, so a text send would land twice. */
	ownerTurnRunning: () => boolean;
}

/** Send one message to the owner, as the shape its field names. */
export async function sendOwnerMessage(deps: OwnerSendDeps, message: OwnerMessage): Promise<SendResult> {
	const { target, signal } = deps;
	if ("text" in message) {
		// The bridge answers a running turn itself, so a text send would land twice.
		if (deps.ownerTurnRunning()) {
			return { ok: false, error: "The bridge replies to this turn automatically; do not repeat it." };
		}
		const trimmed = sanitizeInbound(message.text);
		if (!trimmed) return { ok: false, error: "Nothing to send." };
		return deps.deliverer.toOwner(target.peer, target.contextToken, trimmed, signal());
	}
	// Media cannot duplicate the streamed answer, so a running turn is fine here.
	if ("file" in message) {
		// A document is named by its file: the base name is the display name, and the
		// transport sanitizes it before the item carries it.
		const sent = await deps.deliverer.file(target, message.file, basename(message.file), signal());
		return sent ? { ok: true } : { ok: false, error: "The file could not be sent; see the terminal notice." };
	}
	const sent = await deps.deliverer.image(target, message.image, signal());
	return sent ? { ok: true } : { ok: false, error: "The image could not be sent; see the terminal notice." };
}
