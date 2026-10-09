/**
 * Cross-extension contract for routing interactive prompts to whichever channel
 * owns the current turn.
 *
 * Pi exposes no extension-facing way to replace `ctx.ui`; a remote transport
 * (WeChat) therefore wraps the shared `ctx.ui` object and marks it with
 * {@link INTERACTION_TURN_KEY}. Consumers never read `ctx.mode` to choose a rich
 * component vs. text dialogs; they call {@link askHuman}, so a remote turn falls
 * back to dialogs automatically and a local TUI turn keeps its full-screen UI.
 *
 * Value-only: constants, types, and pure functions. The marker travels on the
 * host's `ctx.ui` object, which every extension shares, and is keyed by a string
 * (not a Symbol) so it is identical across Pi's isolated extension module caches.
 */

import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";

/** The host run modes, derived because the package does not export the union. */
export type InteractionMode = ExtensionContext["mode"];

/** The `ctx.ui` property a remote adapter installs to report turn ownership. */
export const INTERACTION_TURN_KEY = "isRemoteTurn";

/** Label of the automatic free-form entry appended to every `select` option list. */
export const INTERACTION_OTHER_LABEL = "Other (type something)";

/** The four forwardable dialog kinds, mirroring `ExtensionUIContext`. */
export type InteractionKind = "select" | "confirm" | "input" | "editor";

/** A dialog prompt addressed to the human, transport-neutral. */
export interface InteractionRequest {
	kind: InteractionKind;
	title: string;
	/** `select` options, including the trailing {@link INTERACTION_OTHER_LABEL} entry. */
	options?: string[];
	/** `confirm` body. */
	message?: string;
	/** `input` placeholder. */
	placeholder?: string;
	/** `editor` prefill. */
	prefill?: string;
}

/** A resolved dialog outcome; `cancelled` mirrors a dismissed dialog. */
export type InteractionAnswer =
	| { kind: "value"; value: string }
	| { kind: "confirmed"; confirmed: boolean }
	| { kind: "cancelled" };

/** A transport that can answer prompts while its turn is in flight. */
export interface InteractionChannel {
	/** Whether this channel currently owns the turn and should answer prompts. */
	isActive(): boolean;
	/** Ask the human through this channel. */
	request(request: InteractionRequest, signal?: AbortSignal): Promise<InteractionAnswer>;
}

/** The slice of an extension context {@link isRemoteTurn} reads. */
export interface UIContextCarrier {
	ui: unknown;
	mode?: InteractionMode;
}

/** Whether the turn in flight is answered from outside the terminal. */
export function isRemoteTurn(ctx: UIContextCarrier): boolean {
	const ui = ctx.ui as Record<string, unknown> | undefined;
	const marker = ui?.[INTERACTION_TURN_KEY];
	return typeof marker === "function" && (marker as () => boolean)() === true;
}

/** Whether a full-screen `ctx.ui.custom` component may be used for this turn. */
export function supportsCustomUI(ctx: UIContextCarrier): boolean {
	return ctx.mode === "tui" && !isRemoteTurn(ctx);
}

/**
 * Run an interaction, preferring the rich `custom` component for a local TUI
 * turn and falling back to `dialogs` everywhere else (remote turns, RPC, and
 * any non-TUI mode).
 *
 * Callers handle the "no UI at all" case themselves; this only picks a strategy
 * when a UI exists.
 */
export async function askHuman<T>(
	ctx: { ui: ExtensionUIContext; mode: InteractionMode },
	options: { custom: () => Promise<T>; dialogs: () => Promise<T> },
): Promise<T> {
	return supportsCustomUI(ctx) ? options.custom() : options.dialogs();
}
