/**
 * The Shift+Tab chord at the main editor: the plan-mode toggle and the border
 * that says which mode the composer is in, with the live working line riding it.
 *
 * Pi reserves `app.thinking.cycle` on Shift+Tab, so an extension shortcut for the
 * key is refused. The editor is the narrower place to own it: an overlay or a
 * picker has focus instead, so a dialog keeps its own Shift+Tab. Attaching also
 * unsets the built-in cycle binding, because a key that acts and a key the help
 * still claims are two different answers to the same press.
 *
 * Replacing Pi's editor means opting back into what that editor did:
 * `embedWorkingStatus` is what makes the host hand the working indicator over for
 * the top border, as Pi's own editor asks for. Without it the indicator falls back
 * to a row above the composer, and the border would carry the mode colour alone.
 *
 * The mode is plan's to own; this module only asks over the shared channel and
 * reads the branch for the border. Attach once per session and release with the
 * returned cleanup, which reverts only the editor and binding it still owns.
 * Without `plan` there is nothing to toggle, so attach does nothing and Pi keeps
 * its thinking-cycle chord.
 */

import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager as AppKeybindingsManager,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { type EditorTheme, getKeybindings, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";
import { isPlanExtensionLoaded, requestPlanToggle } from "../../../lib/plan-entry.ts";
import { isPlanModeEnabled } from "../../../lib/plan-state.ts";
import { isShiftTab } from "../../../lib/tui/cursor.ts";
import { paint } from "../../../lib/tui/tokens.ts";

/** What the editor reads on every input and frame. */
interface ModeEditorOptions {
	/** Ask the mode's owner to flip it. */
	onToggle: () => void;
	/** The branch is the truth, whoever toggled it. */
	isPlanning: () => boolean;
	/** The role theme, read each frame so a theme change repaints. */
	theme: () => Theme;
}

/** The composer with Shift+Tab bound to plan mode and its border to the mode's own colour. */
export class ModeEditor extends CustomEditor {
	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		private readonly options: ModeEditorOptions,
	) {
		// Pi's manager carries the resolved keybindings config on top of the TUI one;
		// the editor only calls `matches()`, which both provide. The option is the same
		// one Pi's own editor sets, so the working line lands on this border instead of
		// in a row of its own above the composer.
		super(tui, theme, keybindings as unknown as AppKeybindingsManager, { embedWorkingStatus: true });
	}

	override handleInput(data: string): void {
		if (isShiftTab(data)) {
			this.options.onToggle();
			return;
		}
		super.handleInput(data);
	}

	override render(width: number): string[] {
		// The two roles the footer's mode segment draws, so the bar and the composer agree.
		const role = this.options.isPlanning() ? "warn" : "accent";
		this.borderColor = (text) => paint(this.options.theme(), role, text);
		return super.render(width);
	}
}

/** The binding the editor takes over; Pi's default chord for the thinking cycle. */
const THINKING_CYCLE = "app.thinking.cycle";

/**
 * Install the mode editor and take Shift+Tab from the thinking cycle, or return
 * `undefined` when the `plan` extension is not loaded.
 *
 * Returns an idempotent cleanup. It clears the editor only while ours is the
 * installed factory, and restores the binding only while the empty override it
 * wrote is still there, so a later extension's editor or binding is never undone.
 */
export function attachModeKey(
	pi: Pick<ExtensionAPI, "events" | "getAllTools">,
	ctx: ExtensionContext,
): (() => void) | undefined {
	if (!isPlanExtensionLoaded(pi)) return undefined;
	const factory = (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) =>
		new ModeEditor(tui, theme, keybindings, {
			onToggle: () => {
				void requestPlanToggle(pi, ctx);
			},
			isPlanning: () => isPlanModeEnabled(ctx.sessionManager.getBranch()),
			theme: () => ctx.ui.theme,
		});
	const bindings = getKeybindings();
	const previous = bindings.getUserBindings()[THINKING_CYCLE];
	ctx.ui.setEditorComponent(factory);
	bindings.setUserBindings({ ...bindings.getUserBindings(), [THINKING_CYCLE]: [] });

	return () => {
		if (ctx.ui.getEditorComponent() === factory) ctx.ui.setEditorComponent(undefined);
		const current = bindings.getUserBindings()[THINKING_CYCLE];
		if (!Array.isArray(current) || current.length > 0) return;
		const restored = { ...bindings.getUserBindings() };
		if (previous === undefined) delete restored[THINKING_CYCLE];
		else restored[THINKING_CYCLE] = previous;
		bindings.setUserBindings(restored);
	};
}
