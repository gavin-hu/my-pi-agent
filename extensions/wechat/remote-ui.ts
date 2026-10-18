/**
 * The one place in this package that touches the host UI's internals.
 *
 * Pi has no extension-facing way to replace `ctx.ui`, so a remote channel adapts
 * the **shared** UI object every extension reads: `ExtensionRunner.createContext()`
 * exposes `ui` as a getter returning `runner.uiContext`, and `runner.uiContext`
 * is created once and shared (`runner.js:613`). Wrapping its dialogs therefore
 * routes prompts for every extension, and delegating to the saved originals when
 * the channel is inactive preserves the local TUI exactly.
 *
 * This relies on an unstated host implementation detail. If a future Pi release
 * stops sharing a mutable `ctx.ui`, this adapter degrades to today's behaviour
 * (remote prompts stop being forwarded) rather than corrupting state; verify it
 * on host upgrades. If Pi later exposes a pluggable UI delegate, replace this
 * file's contents — {@link InteractionChannel} and its consumers stay unchanged.
 */

import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { INTERACTION_TURN_KEY, type InteractionAnswer, type InteractionChannel } from "../../lib/interaction.ts";

/** The dialog methods this adapter replaces, bound to their original receiver. */
interface Originals {
	select: ExtensionUIContext["select"];
	confirm: ExtensionUIContext["confirm"];
	input: ExtensionUIContext["input"];
	editor: ExtensionUIContext["editor"];
	custom: ExtensionUIContext["custom"];
}

/** Original dialog methods per UI object, so re-installing never chains wrappers. */
const originals = new WeakMap<object, Originals>();

function valueOf(answer: InteractionAnswer): string | undefined {
	return answer.kind === "value" ? answer.value : undefined;
}

/** Install `channel` routing on `ui`; returns an uninstall that restores it. */
export function installRemoteUI(ui: ExtensionUIContext, channel: InteractionChannel): () => void {
	const target = ui as unknown as Record<string, unknown>;
	let saved = originals.get(target);
	if (!saved) {
		// Keep the raw methods so uninstall restores the exact original functions;
		// call them with `.call(ui, ...)` to preserve the receiver.
		saved = {
			select: ui.select,
			confirm: ui.confirm,
			input: ui.input,
			editor: ui.editor,
			custom: ui.custom,
		};
		originals.set(target, saved);
	}

	const active = (): boolean => channel.isActive();

	ui.select = async (title, options, opts) => {
		if (!active()) return saved.select.call(ui, title, options, opts);
		return valueOf(await channel.request({ kind: "select", title, options }, opts?.signal));
	};

	ui.confirm = async (title, message, opts) => {
		if (!active()) return saved.confirm.call(ui, title, message, opts);
		const answer = await channel.request({ kind: "confirm", title, message }, opts?.signal);
		return answer.kind === "confirmed" ? answer.confirmed : false;
	};

	ui.input = async (title, placeholder, opts) => {
		if (!active()) return saved.input.call(ui, title, placeholder, opts);
		return valueOf(await channel.request({ kind: "input", title, placeholder }, opts?.signal));
	};

	ui.editor = async (title, prefill) => {
		if (!active()) return saved.editor.call(ui, title, prefill);
		return valueOf(await channel.request({ kind: "editor", title, prefill }));
	};

	// A full-screen component cannot be rendered remotely, so it is unavailable
	// there (the same contract as RPC mode). Consumers avoid `custom` on a remote
	// turn through `askHuman`; this is the backstop.
	const custom = async (factory: unknown, options?: unknown): Promise<unknown> => {
		if (active()) return undefined;
		return saved.custom.call(ui, factory as never, options as never);
	};
	ui.custom = custom as unknown as ExtensionUIContext["custom"];

	target[INTERACTION_TURN_KEY] = channel;

	return () => {
		ui.select = saved.select;
		ui.confirm = saved.confirm;
		ui.input = saved.input;
		ui.editor = saved.editor;
		ui.custom = saved.custom;
		delete target[INTERACTION_TURN_KEY];
		originals.delete(target);
	};
}

/**
 * A UI context for one peer's own session.
 *
 * A peer session has no terminal, so its extensions get this instead of the
 * host's UI: the four dialogs go to the peer over the bridge's channel,
 * notifications are posted as one short line, and everything that would draw on
 * a terminal is a no-op. `custom` is unavailable for the same reason it is on a
 * remote turn — a full-screen component cannot be shown in a chat window.
 */
export function createPeerUIContext(
	channel: InteractionChannel,
	onNotice?: (message: string) => void,
): ExtensionUIContext {
	const noop = (): void => {};
	const themeStub = new Proxy({} as Record<string, unknown>, {
		get: (_target, key) => (key === "name" ? "peer" : (_color: string, text?: string) => text ?? ""),
	});
	const context = {
		select: async (title: string, options: string[], opts?: { signal?: AbortSignal }) =>
			valueOf(await channel.request({ kind: "select", title, options }, opts?.signal)),
		confirm: async (title: string, message: string, opts?: { signal?: AbortSignal }) => {
			const answer = await channel.request({ kind: "confirm", title, message }, opts?.signal);
			return answer.kind === "confirmed" ? answer.confirmed : false;
		},
		input: async (title: string, placeholder?: string, opts?: { signal?: AbortSignal }) =>
			valueOf(await channel.request({ kind: "input", title, placeholder }, opts?.signal)),
		editor: async (title: string, prefill?: string) =>
			valueOf(await channel.request({ kind: "editor", title, prefill })),
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
	return context as unknown as ExtensionUIContext;
}
