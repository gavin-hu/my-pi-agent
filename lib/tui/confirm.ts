/**
 * The y/N confirmation layer every destructive screen action shares.
 *
 * A screen that can kill, stop, clear, or forget asks first, and the ask is
 * always the same: `y`/`Y`/Enter acts, `n`/`N`/Escape/`q` backs out, and any
 * other key is left to the screen so a stray arrow does not cancel the question.
 * The payload stays with the caller: it hands over a whole closure, so this
 * holds no type parameter and no half-built arguments.
 *
 * Value-only: the pending request lives on the instance.
 */

import { Key, matchesKey } from "@earendil-works/pi-tui";
import { isCloseKey } from "./cursor.ts";

/** What a resolved key asked for. */
export type ConfirmOutcome = "accept" | "dismiss";

export interface ConfirmRequest {
	/** The question, ending in `y/N`. */
	prompt: string;
	/** Runs when the user accepts. */
	accept(): void;
}

export class ConfirmState {
	private request: ConfirmRequest | undefined;

	/** The pending question, or undefined when nothing is being confirmed. */
	get pending(): ConfirmRequest | undefined {
		return this.request;
	}

	/** Ask before acting. Replaces any earlier question. */
	ask(prompt: string, accept: () => void): void {
		this.request = { prompt, accept };
	}

	/** Drop the question without acting. */
	clear(): void {
		this.request = undefined;
	}

	/**
	 * Resolve one key against the pending question.
	 *
	 * Returns `undefined` for a key that is neither an answer nor a dismissal, so
	 * the caller keeps handling it — which is what makes an accidental arrow key
	 * harmless while the prompt is up.
	 */
	resolve(data: string): ConfirmOutcome | undefined {
		if (!this.request) return undefined;
		if (data === "y" || data === "Y" || matchesKey(data, Key.enter)) {
			const request = this.request;
			this.request = undefined;
			request.accept();
			return "accept";
		}
		if (data === "n" || data === "N" || isCloseKey(data) || data === "q") {
			this.request = undefined;
			return "dismiss";
		}
		return undefined;
	}
}
