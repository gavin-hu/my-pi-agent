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

import type { Color } from "@earendil-works/pi-tui";
import type { ExtensionUIContext, Theme, ThemeToken } from "@earendil-works/pi-coding-agent";
import {
	INTERACTION_TURN_KEY,
	type InteractionAnswer,
	type InteractionChannel,
	type InteractionRequest,
} from "../../../lib/interaction.ts";

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
 * The public surface of `Theme`. The class keeps private state, so no double can be
 * assignable to it structurally; this mapped type is what the peer's theme is
 * checked against, and it is the whole guarantee the single `as Theme` below
 * relies on — a member added to or renamed in `Theme` breaks the literal above it.
 */
type ThemeSurface = { readonly [K in keyof Theme]: Theme[K] };

/**
 * No token is ever resolved on a peer turn, so the map is empty rather than invented;
 * `Record<ThemeToken, Color>` has no empty member, which is the one assertion this file
 * makes about a value it does not own.
 */
const NO_COLORS = Object.freeze({}) as Readonly<Record<ThemeToken, Color>>;

/**
 * The theme a peer session styles with: there is no terminal, so a colour or a
 * style returns its text and nothing produces an escape sequence.
 *
 * Identity, not emptiness: `paint()` and the status chips call `theme.fg(token, text)`,
 * so a stub that answered every key with `(_color, text) => text ?? ""` emptied a
 * style call and answered `colors` and `getColorMode()` with a function and `""`.
 */
const peerTheme: ThemeSurface = Object.freeze({
	name: "peer",
	sourcePath: undefined,
	sourceInfo: undefined,
	appearance: "dark" as const,
	get colors(): Readonly<Record<ThemeToken, Color>> {
		return NO_COLORS;
	},
	style: (text) => text,
	fg: (_color, text) => text,
	bg: (_color, text) => text,
	bold: (text) => text,
	italic: (text) => text,
	underline: (text) => text,
	inverse: (text) => text,
	strikethrough: (text) => text,
	getFgAnsi: (_color) => "",
	getBgAnsi: (_color) => "",
	getColorMode: () => "256color" as const,
	getThinkingBorderColor: (_level) => (text) => text,
	getBashModeBorderColor: () => (text) => text,
} satisfies ThemeSurface);

/**
 * A screen a peer session cannot draw.
 *
 * Nothing observes the value: a peer's turn reaches dialogs through `askHuman`
 * (the session is in `rpc` mode), which never mounts a screen, and the peer cannot
 * run another extension's command from the chat. `never` is the honest type for a
 * value no caller can receive, and it needs no double assertion.
 */
async function noScreen<T>(): Promise<T> {
	return undefined as never;
}

/**
 * A UI context for one peer's own session: dialogs, notices, and no-ops for
 * everything that would draw on a terminal.
 *
 * Typed as the host's own interface, so a member added to or renamed in
 * `ExtensionUIContext` fails this file instead of disappearing at runtime.
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
	const context: ExtensionUIContext = {
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
		custom: noScreen,
		pasteToEditor: noop,
		setEditorText: noop,
		getEditorText: () => "",
		addAutocompleteProvider: noop,
		setEditorComponent: noop,
		getEditorComponent: () => undefined,
		get theme() {
			// Theme carries private state, so it is nominal: TypeScript refuses a one-step
			// assertion and nothing structural can stand in for it. The guard is the
			// `satisfies ThemeSurface` above — every public member is this literal's own,
			// so no code path reaches the private state the type claims.
			return peerTheme as unknown as Theme;
		},
		getAllThemes: () => [],
		getTheme: () => undefined,
		setTheme: () => ({ success: false, error: "No terminal for a theme" }),
		getToolsExpanded: () => false,
		setToolsExpanded: noop,
	};
	// `askHuman` reads the marker off the context it is handed; only a context that
	// actually forwards prompts may carry it. The intersection is the marker's type,
	// so attaching it needs no cast.
	return prompts ? Object.assign(context, { [INTERACTION_TURN_KEY]: channel }) : context;
}
