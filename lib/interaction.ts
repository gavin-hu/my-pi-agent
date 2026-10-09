/**
 * Cross-extension contract for routing interactive prompts to whichever channel
 * owns the current turn.
 *
 * Pi exposes no extension-facing way to replace `ctx.ui`; a remote transport
 * (WeChat) therefore wraps the shared `ctx.ui` object and installs its
 * {@link InteractionChannel} under {@link INTERACTION_TURN_KEY}. Consumers never
 * read `ctx.mode` to choose a rich component vs. text dialogs; they call
 * {@link askHuman}, so a remote turn falls back to dialogs (with an optional file
 * or text preface) and a local TUI turn keeps its full-screen UI.
 *
 * Value-only: constants, types, and pure functions. The marker travels on the
 * host's `ctx.ui` object, which every extension shares, and is keyed by a string
 * (not a Symbol) so it is identical across Pi's isolated extension module caches.
 */

import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";

/** The host run modes, derived because the package does not export the union. */
export type InteractionMode = ExtensionContext["mode"];

/** The `ctx.ui` property a remote adapter installs its channel under. */
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
	/** Post plain text to the human (best-effort). */
	post(text: string, signal?: AbortSignal): Promise<void>;
	/** Send a local file to the human; resolves true when delivered. */
	postFile(path: string, name: string, signal?: AbortSignal): Promise<boolean>;
}

/** The slice of an extension context {@link remoteChannel} reads. */
export interface UIContextCarrier {
	ui: unknown;
	mode?: InteractionMode;
}

function asChannel(value: unknown): InteractionChannel | undefined {
	if (!value || typeof value !== "object") return undefined;
	const candidate = value as Partial<InteractionChannel>;
	return typeof candidate.isActive === "function" ? (value as InteractionChannel) : undefined;
}

/** The remote channel that owns the current turn, or undefined. */
export function remoteChannel(ctx: UIContextCarrier): InteractionChannel | undefined {
	const ui = ctx.ui as Record<string, unknown> | undefined;
	const channel = asChannel(ui?.[INTERACTION_TURN_KEY]);
	return channel?.isActive() ? channel : undefined;
}

/** Whether the turn in flight is answered from outside the terminal. */
export function isRemoteTurn(ctx: UIContextCarrier): boolean {
	return remoteChannel(ctx) !== undefined;
}

/** Whether a full-screen `ctx.ui.custom` component may be used for this turn. */
export function supportsCustomUI(ctx: UIContextCarrier): boolean {
	return ctx.mode === "tui" && !isRemoteTurn(ctx);
}

export interface AskHumanOptions<T> {
	/** The rich component, used for a local TUI turn. */
	custom: () => Promise<T>;
	/** The text dialogs, used everywhere else (remote turn, RPC, non-TUI). */
	dialogs: () => Promise<T>;
	/** A local file a remote channel sends before the dialogs. */
	file?: { path: string; name: string };
	/** Text a remote channel posts before the dialogs, or when the file fails. */
	body?: string;
}

/**
 * Run an interaction, preferring the rich `custom` component for a local TUI
 * turn and falling back to `dialogs` everywhere else.
 *
 * For a remote turn, a `file` (then `body` if the file could not be sent) is
 * delivered first, so a long artifact the component would have shown is available
 * to the remote human too. Delivery is best-effort and never blocks the dialogs.
 *
 * Callers handle the "no UI at all" case themselves.
 */
export async function askHuman<T>(
	ctx: { ui: ExtensionUIContext; mode: InteractionMode },
	options: AskHumanOptions<T>,
): Promise<T> {
	if (supportsCustomUI(ctx)) return options.custom();
	const channel = remoteChannel(ctx);
	if (channel) {
		try {
			if (options.file) {
				const sent = await channel.postFile(options.file.path, options.file.name);
				if (!sent && options.body) await channel.post(options.body);
			} else if (options.body) {
				await channel.post(options.body);
			}
		} catch {
			// The preface is best-effort; the dialogs still run.
		}
	}
	return options.dialogs();
}
