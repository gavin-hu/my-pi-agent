/**
 * Cross-extension contract for routing interactive prompts to whichever channel
 * owns the current turn.
 *
 * A transport that answers prompts outside the terminal takes over the turn's
 * dialogs: {@link markRemoteTurn} installs `select` / `confirm` / `input` /
 * `editor` on the session's UI context, answers them through the transport's
 * channel, and marks it under {@link INTERACTION_TURN_KEY} for the one step up —
 * {@link askHuman}'s preface, and the short prompt a caller chooses. The
 * takeover lasts one turn, so a terminal turn keeps its dialogs. Consumers never
 * read `ctx.mode` to choose a rich component vs. text dialogs; they call
 * {@link askHuman}, so a remote turn falls back to dialogs (with an optional file
 * or text preface) and a local TUI turn keeps its full-screen UI.
 *
 * Value-only: constants, types, and pure functions. The marker travels on the UI
 * context the transport marked and is keyed by a string (not a Symbol) so it is
 * identical across Pi's isolated extension module caches.
 */

import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";

/** The host run modes, derived because the package does not export the union. */
export type InteractionMode = ExtensionContext["mode"];

/** The two languages a remote prompt is rendered in. */
export type InteractionLanguage = "zh" | "en";

/** The `ctx.ui` property a remote transport marks with the channel that owns its turn. */
export const INTERACTION_TURN_KEY = "isRemoteTurn";

/** Label of the automatic free-form entry appended to every `select` option list. */
export const INTERACTION_OTHER_LABEL = "Other (type something)";

/** The four forwardable dialog kinds, mirroring `ExtensionUIContext`. */
type InteractionKind = "select" | "confirm" | "input" | "editor";

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
	/** The language this channel renders prompts in, when it knows one. */
	language?(): InteractionLanguage;
	/**
	 * Widen the bound on the prompts asked inside the returned scope: use it for a
	 * dialog the human must read something before answering. Returns the restore,
	 * and a transport with no such policy omits the method.
	 */
	setPromptTimeout?(ms: number): () => void;
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

/** The remote channel marked on this UI context, or undefined when it is local. */
export function remoteChannel(ctx: UIContextCarrier): InteractionChannel | undefined {
	const ui = ctx.ui as Record<string, unknown> | undefined;
	const channel = asChannel(ui?.[INTERACTION_TURN_KEY]);
	return channel?.isActive() ? channel : undefined;
}

/** Whether the turn in flight is answered from outside the terminal. */
export function isRemoteTurn(ctx: UIContextCarrier): boolean {
	return remoteChannel(ctx) !== undefined;
}

/** The remote channel's prompt language, or undefined for a local turn. */
export function remoteLanguage(ctx: UIContextCarrier): InteractionLanguage | undefined {
	return remoteChannel(ctx)?.language?.();
}

/** The language a prompt is written in: the remote channel's, or English at the terminal. */
export function dialogLanguage(ctx: UIContextCarrier): InteractionLanguage {
	return remoteLanguage(ctx) ?? "en";
}

/** Whether a full-screen `ctx.ui.custom` component may be used for this turn. */
export function supportsCustomUI(ctx: UIContextCarrier): boolean {
	return ctx.mode === "tui" && !isRemoteTurn(ctx);
}

/** The dialogs a remote turn takes over: the four members a prompt can be asked through. */
const REMOTE_DIALOGS = ["select", "confirm", "input", "editor"] as const;

type RemoteDialog = (typeof REMOTE_DIALOGS)[number];

/**
 * Take over the four dialogs of `ui` for one remote turn, and return the restore.
 *
 * A transport calls this as its turn starts: every prompt raised inside it — a
 * tool's `confirm`, a review's `select` — is then answered through `channel`
 * instead of on the terminal, which is what keeps the turn off a keyboard nobody
 * is at. `custom` is not one of them: a full-screen component has nowhere to go
 * on a phone, and {@link supportsCustomUI} already keeps {@link askHuman}'s
 * callers off it.
 *
 * Each member and the marker are best-effort, so a sealed UI context keeps that
 * dialog local rather than failing the turn. The restore is idempotent, and it
 * leaves a member alone that something else replaced after this call — a newer
 * takeover must not be undone by an older one's restore.
 */
export function markRemoteTurn(ui: Record<string, unknown>, channel: InteractionChannel): () => void {
	const members: Pick<ExtensionUIContext, RemoteDialog> = {
		select: async (title, options, opts) => {
			const answer = await channel.request({ kind: "select", title, options }, opts?.signal);
			return answer.kind === "value" ? answer.value : undefined;
		},
		confirm: async (title, message, opts) => {
			const answer = await channel.request({ kind: "confirm", title, message }, opts?.signal);
			return answer.kind === "confirmed" ? answer.confirmed : false;
		},
		input: async (title, placeholder, opts) => {
			const answer = await channel.request({ kind: "input", title, placeholder }, opts?.signal);
			return answer.kind === "value" ? answer.value : undefined;
		},
		editor: async (title, prefill) => {
			const answer = await channel.request({ kind: "editor", title, prefill });
			return answer.kind === "value" ? answer.value : undefined;
		},
	};
	/** The undo for each write, in the order it was made. */
	const undo: Array<() => void> = [];
	for (const name of REMOTE_DIALOGS) {
		try {
			const previous = Object.getOwnPropertyDescriptor(ui, name);
			const member = members[name];
			ui[name] = member;
			undo.push(() => {
				// A member replaced after this call belongs to whoever replaced it.
				if (ui[name] !== member) return;
				if (previous) Object.defineProperty(ui, name, previous);
				else delete ui[name];
			});
		} catch {
			// A sealed context keeps the terminal's dialog; the turn still runs.
		}
	}
	try {
		ui[INTERACTION_TURN_KEY] = channel;
		undo.push(() => {
			if (ui[INTERACTION_TURN_KEY] === channel) delete ui[INTERACTION_TURN_KEY];
		});
	} catch {
		// Without the marker only the preface is lost; the dialogs still answer.
	}
	let restored = false;
	return () => {
		if (restored) return;
		restored = true;
		for (const step of undo.reverse()) {
			try {
				step();
			} catch {
				// A context sealed after the takeover keeps what it holds.
			}
		}
	};
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
	/**
	 * A short digest a remote channel posts before the dialogs even when the file
	 * was delivered. Use it for the decision-relevant summary of an artifact whose
	 * attachment may never be opened (a phone client can hide a file bubble).
	 */
	note?: string;
	/**
	 * How long a remote channel may wait for the answer before dismissing the
	 * dialog. Raise it when the human has to read an artifact first; the channel's
	 * own bound applies when it is omitted or unsupported.
	 */
	timeoutMs?: number;
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
			// A digest is sent even when the file went out: the attachment may never be
			// opened, and the choice still has to be answerable from the chat itself.
			if (options.note) await channel.post(options.note);
		} catch {
			// The preface is best-effort; the dialogs still run.
		}
	}
	const restore = options.timeoutMs === undefined ? undefined : channel?.setPromptTimeout?.(options.timeoutMs);
	try {
		return await options.dialogs();
	} finally {
		restore?.();
	}
}
