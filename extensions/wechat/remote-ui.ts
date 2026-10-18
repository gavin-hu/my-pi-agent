/**
 * The UI context a WeChat peer session gets.
 *
 * A peer session has no terminal, so `openPeerSession` binds this context with
 * `bindExtensions({ mode: "rpc", uiContext })`: the four dialogs go to the peer
 * over the bridge's channel, notifications are posted as one short line, and
 * everything that would draw on a terminal is a no-op.
 *
 * The context marks itself with the channel under {@link INTERACTION_TURN_KEY},
 * so `askHuman` finds it and delivers the optional file/text preface before the
 * dialogs. Marking the *peer's own* context — rather than the terminal's shared
 * `ctx.ui` — is what keeps a terminal turn's dialogs in the terminal: with one
 * session per peer there is nothing to adapt on the host side, and doing it
 * routed a local turn's prompt to whichever peer happened to be running.
 *
 * `prompts: false` (the `remotePrompts` setting) keeps the notifications but
 * answers every dialog as cancelled, so a peer turn cannot be asked a question
 * the operator chose not to forward.
 */

import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import {
	INTERACTION_TURN_KEY,
	type InteractionAnswer,
	type InteractionChannel,
	type InteractionRequest,
} from "../../lib/interaction.ts";

function valueOf(answer: InteractionAnswer): string | undefined {
	return answer.kind === "value" ? answer.value : undefined;
}

/** How a peer session's dialogs are answered. */
export interface PeerUIOptions {
	/**
	 * Forward dialogs to the peer. `false` answers every dialog as cancelled and
	 * leaves the context unmarked, so `askHuman` treats it like a local turn and
	 * skips the file/text preface. Default `true`.
	 */
	prompts?: boolean;
}

/**
 * A UI context for one peer's own session: dialogs, notices, and no-ops for
 * everything that would draw on a terminal.
 */
export function createPeerUIContext(
	channel: InteractionChannel,
	onNotice?: (message: string) => void,
	options: PeerUIOptions = {},
): ExtensionUIContext {
	const prompts = options.prompts ?? true;
	const noop = (): void => {};
	/** A dialog that is not forwarded fails closed: the caller sees a dismissal. */
	const ask = (request: InteractionRequest, signal?: AbortSignal): Promise<InteractionAnswer> =>
		prompts ? channel.request(request, signal) : Promise.resolve({ kind: "cancelled" });
	const themeStub = new Proxy({} as Record<string, unknown>, {
		get: (_target, key) => (key === "name" ? "peer" : (_color: string, text?: string) => text ?? ""),
	});
	const context: Record<string, unknown> = {
		select: async (title: string, options: string[], opts?: { signal?: AbortSignal }) =>
			valueOf(await ask({ kind: "select", title, options }, opts?.signal)),
		confirm: async (title: string, message: string, opts?: { signal?: AbortSignal }) => {
			const answer = await ask({ kind: "confirm", title, message }, opts?.signal);
			return answer.kind === "confirmed" ? answer.confirmed : false;
		},
		input: async (title: string, placeholder?: string, opts?: { signal?: AbortSignal }) =>
			valueOf(await ask({ kind: "input", title, placeholder }, opts?.signal)),
		editor: async (title: string, prefill?: string) => valueOf(await ask({ kind: "editor", title, prefill })),
		notify: (message: string) => {
			onNotice?.(message);
			void channel.post(message);
		},
		onTerminalInput: () => () => {},
		setStatus: noop,
		setWorkingMessage: noop,
		setWorkingVisible: noop,
		setWorkingIndicator: noop,
		setHiddenThinkingLabel: noop,
		setWidget: noop,
		setFooter: noop,
		setHeader: noop,
		setTitle: noop,
		// No terminal: a full-screen component has nothing to draw on.
		custom: async () => undefined,
		pasteToEditor: noop,
		setEditorText: noop,
		getEditorText: () => "",
		addAutocompleteProvider: noop,
		setEditorComponent: noop,
		getEditorComponent: () => undefined,
		get theme() {
			return themeStub;
		},
		getAllThemes: () => [],
		getTheme: () => undefined,
		setTheme: () => ({ success: false, error: "No terminal for a theme" }),
		getToolsExpanded: () => false,
		setToolsExpanded: noop,
	};
	// `askHuman` reads the marker off the context it is handed; only a context
	// that actually forwards prompts may carry it.
	if (prompts) context[INTERACTION_TURN_KEY] = channel;
	return context as unknown as ExtensionUIContext;
}
