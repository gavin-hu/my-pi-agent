/**
 * Turn one assistant answer into a few chat messages instead of one lump.
 *
 * WeChat notifies per bubble, so streaming means choosing where to break: a
 * paragraph boundary is the natural one, a timer covers an answer that stalls
 * mid-paragraph, and a character cap bounds a single bubble. Every part is sent
 * once, in order, and the remainder goes out when the turn ends — never
 * duplicated, never re-numbered per part.
 *
 * Value-only: no module-level state, and the timer is injected so a test can
 * drive it.
 */

export interface ReplyPipelineDeps {
	/** Send one part to the peer. Parts arrive strictly in order. */
	sendPart: (text: string) => Promise<void>;
	/** Arm a one-shot timer; the returned function cancels it. */
	armTimer: (ms: number, fn: () => void) => () => void;
	/** Flush a part that reaches this many characters. Default 400. */
	partChars?: number;
	/** Flush a part that has been quiet this long. Default 2000 ms. */
	quietMs?: number;
}

export interface ReplyPipeline {
	/** Add streamed text; parts go out as boundaries are crossed. */
	push(delta: string): void;
	/** Send whatever is left and resolve once every part is out. */
	finish(): Promise<void>;
	/** Drop the unsent remainder (an aborted turn) and cancel the timer. */
	drop(): void;
	/** Everything produced so far, flushed or not. */
	text(): string;
	/** Everything already handed to `sendPart`. */
	sent(): string;
}

const DEFAULT_PART_CHARS = 400;
const DEFAULT_QUIET_MS = 2000;

/** The last paragraph break in `text`, or -1. */
function paragraphBreak(text: string): number {
	return text.lastIndexOf("\n\n");
}

/** The last whitespace at or before `limit`, so a part does not cut a word. */
function softBreak(text: string, limit: number): number {
	const window = text.slice(0, limit);
	const newline = window.lastIndexOf("\n");
	const space = window.lastIndexOf(" ");
	return Math.max(newline, space);
}

export function createReplyPipeline(deps: ReplyPipelineDeps): ReplyPipeline {
	const partChars = Math.max(1, deps.partChars ?? DEFAULT_PART_CHARS);
	const quietMs = Math.max(1, deps.quietMs ?? DEFAULT_QUIET_MS);
	let buffer = "";
	let produced = "";
	let delivered = "";
	let timer: (() => void) | undefined;
	/** Serializes sends so parts cannot overtake each other. */
	let chain: Promise<void> = Promise.resolve();

	function cancelQuiet(): void {
		timer?.();
		timer = undefined;
	}

	function scheduleQuiet(): void {
		cancelQuiet();
		timer = deps.armTimer(quietMs, () => {
			timer = undefined;
			flushBreak();
		});
	}

	/** Send `text` after everything already queued, trimming surrounding blanks. */
	function enqueue(text: string): void {
		const part = text.replace(/^\s+/, "").replace(/\s+$/, "");
		if (part === "") return;
		delivered += part;
		chain = chain.then(() => deps.sendPart(part)).catch(() => {});
	}

	/** Flush everything up to the last paragraph break, if there is one. */
	function flushBreak(): void {
		const index = paragraphBreak(buffer);
		if (index < 0) {
			if (buffer.length >= partChars) flushCap();
			return;
		}
		const part = buffer.slice(0, index + 2);
		buffer = buffer.slice(index + 2);
		enqueue(part);
	}

	/** Flush one part's worth, breaking on a word boundary when there is one. */
	function flushCap(): void {
		if (buffer.length < partChars) return;
		const cut = softBreak(buffer, partChars);
		const index = cut > 0 ? cut : partChars;
		const part = buffer.slice(0, index);
		buffer = buffer.slice(index);
		enqueue(part);
	}

	return {
		push(delta: string): void {
			if (!delta) return;
			buffer += delta;
			produced += delta;
			if (paragraphBreak(buffer) >= 0) {
				flushBreak();
				if (buffer.length >= partChars) flushCap();
				scheduleQuiet();
				return;
			}
			if (buffer.length >= partChars) {
				flushCap();
				scheduleQuiet();
				return;
			}
			scheduleQuiet();
		},

		async finish(): Promise<void> {
			cancelQuiet();
			enqueue(buffer);
			buffer = "";
			await chain;
		},

		drop(): void {
			cancelQuiet();
			buffer = "";
		},

		text(): string {
			return produced;
		},

		sent(): string {
			return delivered;
		},
	};
}
