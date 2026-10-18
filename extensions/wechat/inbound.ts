/**
 * Inbound media and the hand-off to a peer's session.
 *
 * An image is downloaded, decrypted, and attached as model image content; a file
 * is saved under the media directory and referenced by path. Every failure is
 * counted so the peer can be told, because an attachment the bridge could not
 * read must not look like the model ignoring a photo.
 */

import type { ImageContent } from "@earendil-works/pi-ai";
import type { BotCredentials, InboundItem } from "./types.ts";
import type { WechatClient } from "./client.ts";
import type { PeerItem } from "./peer-worker.ts";
import { messageOf } from "./errors.ts";
import { decodeMediaKey, decryptEcb, saveMedia, sniffImageMime } from "./media.ts";
import { notice } from "./notices.ts";

/** What the inbound side needs from the bridge; every value is read at call time. */
export interface InboundDeps {
	client: () => WechatClient | undefined;
	account: () => BotCredentials | undefined;
	signal: () => AbortSignal | undefined;
	maxMediaBytes: () => number;
	mediaDir: () => string;
	now: () => number;
	notify: (message: string, kind?: "info" | "warning" | "error") => void;
	/** Answer a message that has nothing readable. */
	reply: (item: InboundItem, text: string) => Promise<unknown>;
	/** Hand a resolved message to the peer's own session. */
	enqueue: (item: PeerItem) => void;
	pruneTyping: () => void;
	isRunning: () => boolean;
}

/** Resolve inbound media and admit the message to the peer's queue. */
export interface InboundAdmission {
	admit(item: InboundItem): Promise<void>;
	/** Media the bridge dropped since this connection opened. */
	dropped(): number;
	/** Reset the dropped counter (a new connection). */
	reset(): void;
}

export function createInboundAdmission(deps: InboundDeps): InboundAdmission {
	let mediaDropped = 0;
	let mediaCounter = 0;

	/**
	 * Download, decrypt, and split what the peer sent into a prompt text and image
	 * blocks. A file is saved and referenced by path; an image becomes model image
	 * content. Every failure is counted so the peer can be told.
	 */
	async function resolveMedia(item: InboundItem): Promise<{
		images: ImageContent[];
		files: string[];
		dropped: number;
	}> {
		const images: ImageContent[] = [];
		const files: string[] = [];
		let dropped = 0;
		const client = deps.client();
		for (const ref of item.media) {
			if (!client) break;
			try {
				const cipher = await client.downloadCdn(ref.media, deps.signal());
				if (cipher.byteLength > deps.maxMediaBytes()) {
					mediaDropped += 1;
					dropped += 1;
					deps.notify(`WeChat media dropped: over ${deps.maxMediaBytes()} bytes.`, "warning");
					continue;
				}
				if (ref.kind === "file") {
					if (!ref.media.aes_key) throw new Error("missing AES key");
					const plain = decryptEcb(cipher, decodeMediaKey(ref.media.aes_key));
					mediaCounter += 1;
					const path = saveMedia(deps.mediaDir(), `${deps.now()}-${mediaCounter}-${ref.fileName}`, plain);
					files.push(`[WeChat file: ${ref.fileName} saved to ${path}]`);
				} else {
					// Without a key the bytes are not the image the peer sent; attaching them
					// anyway would hand the model a corrupt JPEG.
					const key = ref.aeskey ?? ref.media.aes_key;
					if (!key) throw new Error("missing AES key");
					const plain = decryptEcb(cipher, decodeMediaKey(key));
					images.push({
						type: "image",
						data: Buffer.from(plain).toString("base64"),
						mimeType: sniffImageMime(plain),
					});
				}
			} catch (error) {
				mediaDropped += 1;
				dropped += 1;
				deps.notify(`WeChat media dropped: ${messageOf(error)}`, "warning");
			}
		}
		return { images, files, dropped };
	}

	return {
		/**
		 * Resolve media, then hand the message to the peer's own session.
		 *
		 * An attachment the bridge could not read is never silent: the model gets a
		 * `[WeChat media skipped]` block and the peer's reply opens with one line, so a
		 * failed download cannot look like the model ignoring a photo. A message with
		 * nothing readable is answered here instead of starting an empty turn.
		 */
		async admit(item: InboundItem): Promise<void> {
			let text = item.text;
			let images: ImageContent[] | undefined;
			let prefix: string | undefined;
			if (item.media.length > 0) {
				const resolved = await resolveMedia(item);
				if (!deps.isRunning()) return;
				if (!text && resolved.images.length === 0 && resolved.files.length === 0) {
					if (resolved.dropped > 0) prefix = notice("media", item.language, resolved.dropped);
					await deps.reply(item, prefix ?? notice("unsupported", item.language));
					deps.pruneTyping();
					return;
				}
				if (resolved.dropped > 0) {
					prefix = notice("media", item.language, resolved.dropped);
					text = [text, `[WeChat media skipped: ${resolved.dropped}]`].filter(Boolean).join("\n");
				}
				if (resolved.files.length > 0) text = [text, ...resolved.files].filter(Boolean).join("\n");
				images = resolved.images.length > 0 ? resolved.images : undefined;
			}
			if (!text && !images) {
				await deps.reply(item, notice("unsupported", item.language));
				deps.pruneTyping();
				return;
			}
			const queued: PeerItem = {
				peer: item.peer,
				text,
				images,
				prefix,
				language: item.language,
				contextToken: item.contextToken,
			};
			deps.enqueue(queued);
		},

		dropped(): number {
			return mediaDropped;
		},

		reset(): void {
			mediaDropped = 0;
		},
	};
}
