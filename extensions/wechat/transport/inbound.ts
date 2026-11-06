/**
 * Inbound media and the hand-off to the turn queue.
 *
 * An image is downloaded, decrypted, and attached as model image content; a file
 * is saved under the media directory and referenced by path, with the size and the
 * type its bytes name. Every failure is counted so the peer can be told, because an
 * attachment the bridge could not read must not look like the model ignoring a photo.
 */

import { readFileSync } from "node:fs";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { FileRef, ImageRef, InboundItem, MediaRef } from "../types.ts";
import type { WechatClient } from "./client.ts";
import type { ChatItem } from "../conversation/turn.ts";
import type { PeerLanguage } from "../text/format.ts";
import { messageOf } from "../../../lib/errors.ts";
import { formatSize } from "../../../lib/format.ts";
import {
	decodeMediaKey,
	decryptEcb,
	findSavedFile,
	isPaddingFailure,
	saveMedia,
	savedFileName,
	sniffFileMime,
	sniffImageMime,
} from "./media.ts";
import { notice } from "../text/notices.ts";

/** What the inbound side needs from the bridge; every value is read at call time. */
export interface InboundDeps {
	client: () => WechatClient | undefined;
	signal: () => AbortSignal | undefined;
	maxMediaBytes: () => number;
	mediaDir: () => string;
	now: () => number;
	notify: (message: string, kind?: "info" | "warning" | "error") => void;
	/** Answer a message that has nothing readable. */
	reply: (item: InboundItem, text: string) => Promise<unknown>;
	/** Hand a resolved message to the turn queue. */
	enqueue: (item: ChatItem) => void;
	pruneTyping: () => void;
	isRunning: () => boolean;
}

/** Resolve inbound media and admit the message to the conversation. */
export interface InboundAdmission {
	/**
	 * Resolve media, then hand the message over. `live()` is false once a stop drained it, so
	 * a download that outlived the burst it came in with drops the message instead of
	 * handing over a turn the peer was told had gone.
	 */
	admit(item: InboundItem, live: () => boolean): Promise<void>;
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
	 * blocks. A file is saved and referenced by path, with the size and sniffed type
	 * its own bytes give it; an image becomes model image content. Every failure is
	 * counted so the peer can be told, and a repeat counted apart, because resending
	 * one can never work.
	 */
	async function resolveMedia(item: InboundItem): Promise<{
		images: ImageContent[];
		files: string[];
		dropped: number;
		repeated: number;
	}> {
		const images: ImageContent[] = [];
		const files: string[] = [];
		let dropped = 0;
		let repeated = 0;
		const client = deps.client();
		for (const ref of item.media) {
			if (!client) break;
			try {
				const cipher = await client.downloadCdn(ref.media, {
					maxBytes: deps.maxMediaBytes(),
					signal: deps.signal(),
				});
				if (ref.kind === "file") files.push(saveFile(ref, cipher));
				else images.push(attachImage(ref, cipher));
			} catch (error) {
				mediaDropped += 1;
				dropped += 1;
				if (isRepeatOfStoredCopy(ref, error)) repeated += 1;
				deps.notify(droppedMessage(ref, error), "warning");
			}
		}
		return { images, files, dropped, repeated };
	}

	/**
	 * What the peer is told about attachments that could not be read: the ordinary count,
	 * and the repeats counted apart, because resending one of those can never work.
	 */
	function droppedNotice(language: PeerLanguage, dropped: number, repeated: number): string | undefined {
		const lines: string[] = [];
		if (dropped > repeated) lines.push(notice("media", language, dropped - repeated));
		if (repeated > 0) lines.push(notice("mediaRepeat", language, repeated));
		return lines.length > 0 ? lines.join("\n") : undefined;
	}

	/** The line a turn is handed for a file on disk: what it is, how big, and where it landed. */
	function fileLine(ref: FileRef, plain: Uint8Array, path: string): string {
		// What the turn is told is the saved bytes': a `report.docx` that holds a PDF is
		// named a PDF, and the size is the one a `read` of that path will find.
		const mime = sniffFileMime(plain);
		const label = [ref.fileName, formatSize(plain.length), ...(mime ? [mime] : [])].join(", ");
		return `[WeChat file: ${label}, saved to ${path}]`;
	}

	/**
	 * Decrypt one file, save it under its content hash, and return its line.
	 *
	 * The CDN keeps one blob per content, so the second time a peer sends the same file
	 * the wire carries a key that never encrypted it and the last block is refused. The
	 * hash in the name is what makes that repeat resolvable: the copy saved earlier is
	 * the same bytes, so it is handed over rather than dropped.
	 */
	function saveFile(ref: FileRef, cipher: Uint8Array): string {
		const dir = deps.mediaDir();
		try {
			if (!ref.media.aes_key) throw new Error("missing AES key");
			const plain = decryptEcb(cipher, decodeMediaKey(ref.media.aes_key));
			mediaCounter += 1;
			const path = saveMedia(dir, savedFileName(deps.now(), mediaCounter, ref.md5, ref.fileName), plain);
			return fileLine(ref, plain, path);
		} catch (error) {
			if (!isPaddingFailure(error)) throw error;
			const saved = findSavedFile(dir, ref.md5);
			if (!saved) throw error;
			deps.notify(
				`WeChat stored this repeat of ${ref.fileName} under a different key; used the copy saved earlier.`,
				"info",
			);
			return fileLine(ref, readFileSync(saved), saved);
		}
	}

	/** One image's model block: the bytes as decrypted, typed by their own header. */
	function attachImage(ref: ImageRef, cipher: Uint8Array): ImageContent {
		// Without a key the bytes are not the image the peer sent; attaching them anyway
		// would hand the model a corrupt JPEG.
		const key = ref.aeskey ?? ref.media.aes_key;
		if (!key) throw new Error("missing AES key");
		const plain = decryptEcb(cipher, decodeMediaKey(key));
		return {
			type: "image",
			data: Buffer.from(plain).toString("base64"),
			mimeType: sniffImageMime(plain) ?? "image/jpeg",
		};
	}

	/**
	 * Whether this failure is a file the server stored once: the key it sent never
	 * encrypted those bytes, so the ref is the file and no other kind of attachment.
	 */
	function isRepeatOfStoredCopy(ref: MediaRef, error: unknown): ref is FileRef {
		return ref.kind === "file" && isPaddingFailure(error);
	}

	/** How a dropped attachment is named: a repeat's dead key is the server's own dedup, not a fault here. */
	function droppedMessage(ref: MediaRef, error: unknown): string {
		if (isRepeatOfStoredCopy(ref, error)) {
			return `WeChat media dropped: ${ref.fileName} — the server kept an earlier copy under another key, so this repeat cannot be read.`;
		}
		return `WeChat media dropped: ${messageOf(error)}`;
	}

	return {
		/**
		 * Resolve media, then hand the message to the turn queue.
		 *
		 * An attachment the bridge could not read is never silent: the model gets a
		 * `[WeChat media skipped]` block and the peer's reply opens with one line, so a
		 * failed download cannot look like the model ignoring a photo. A message with
		 * nothing readable is answered here instead of starting an empty turn.
		 */
		async admit(item: InboundItem, live: () => boolean): Promise<void> {
			let text = item.text;
			let images: ImageContent[] | undefined;
			let prefix: string | undefined;
			if (item.media.length > 0) {
				const resolved = await resolveMedia(item);
				if (!live()) {
					// A stop landed while this was downloading. The stop has already said how many
					// messages it took, so the message goes quietly and the hand-off never happens.
					return;
				}
				if (!deps.isRunning()) {
					// A close interrupted the download. Nothing has been written down for this
					// message — neither the cursor nor its seen id — so the next connection reads
					// it again; saying so is what keeps the gap from looking like a delivery.
					deps.notify(
						"WeChat stopped while a message was downloading; it will be read again on the next start.",
						"warning",
					);
					return;
				}
				// The bridge has already refused a message with no text and no media, so
				// this is the other case: media arrived but nothing in it could be read.
				if (!text && resolved.images.length === 0 && resolved.files.length === 0) {
					prefix = droppedNotice(item.language, resolved.dropped, resolved.repeated);
					await deps.reply(item, prefix ?? notice("unsupported", item.language));
					deps.pruneTyping();
					return;
				}
				if (resolved.dropped > 0) {
					prefix = droppedNotice(item.language, resolved.dropped, resolved.repeated);
					text = [text, `[WeChat media skipped: ${resolved.dropped}]`].filter(Boolean).join("\n");
				}
				if (resolved.files.length > 0) text = [text, ...resolved.files].filter(Boolean).join("\n");
				images = resolved.images.length > 0 ? resolved.images : undefined;
			}
			const queued: ChatItem = {
				peer: item.peer,
				text,
				images,
				prefix,
				language: item.language,
				contextToken: item.contextToken,
			};
			// The drain can also land across the answer a message with nothing readable gets.
			if (!live()) return;
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
