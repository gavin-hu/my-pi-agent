/**
 * The panel's text-editing state machine.
 *
 * One key in, the next editing state out; the component owns the settings write,
 * the write chain, and the repaint. Esc cancels the edit instead of closing the
 * screen, Enter asks the caller to commit, and everything else the screen binds
 * is inert until the editor closes.
 */

import { Key, matchesKey } from "@earendil-works/pi-tui";
import { isCloseKey } from "../../../../lib/tui/cursor.ts";

/** Bracketed-paste markers a terminal wraps around pasted text. */
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

/** The text row being edited: its id, the buffer, and the caret offset. */
export interface EditingState {
	id: string;
	buffer: string;
	caret: number;
}

/** What one editing key asked for. */
export type EditAction =
	| { kind: "cancel" }
	| { kind: "commit" }
	| { kind: "update"; state: EditingState; changed: boolean };

/**
 * Apply one key to the editing state.
 *
 * `maxLength` comes from the setting's text rule; an undefined limit means the
 * row has no text rule, so typed characters are refused rather than stored
 * unvalidated. A key that changes nothing (Backspace at the start, a refused
 * character) reports `changed: false`, so the caller does not ask for a frame.
 */
export function applyEditKey(data: string, state: EditingState, maxLength: number | undefined): EditAction {
	if (isCloseKey(data)) return { kind: "cancel" };
	if (matchesKey(data, Key.enter)) return { kind: "commit" };

	const { buffer, caret } = state;
	let next = state;
	if (matchesKey(data, Key.backspace)) {
		if (caret > 0) next = { ...state, buffer: buffer.slice(0, caret - 1) + buffer.slice(caret), caret: caret - 1 };
	} else if (matchesKey(data, Key.delete)) {
		if (caret < buffer.length) next = { ...state, buffer: buffer.slice(0, caret) + buffer.slice(caret + 1) };
	} else if (matchesKey(data, Key.left)) {
		next = { ...state, caret: Math.max(0, caret - 1) };
	} else if (matchesKey(data, Key.right)) {
		next = { ...state, caret: Math.min(buffer.length, caret + 1) };
		// `Ctrl+A`/`Ctrl+E` are the emacs spellings of Home/End, which pi-tui's
		// `Key.home`/`Key.end` do not match; both are offered because a terminal
		// may send either.
	} else if (matchesKey(data, Key.home) || matchesKey(data, "ctrl+a")) {
		next = { ...state, caret: 0 };
	} else if (matchesKey(data, Key.end) || matchesKey(data, "ctrl+e")) {
		next = { ...state, caret: buffer.length };
	} else if (matchesKey(data, "ctrl+u")) {
		next = { ...state, buffer: "", caret: 0 };
	} else {
		// A pasted chunk arrives wrapped in bracketed-paste markers. Its ESC is
		// dropped by the filter below, which would leave `[200~` in the value, so
		// strip the markers first, the way Pi's own Input and Editor do.
		const text = data.replaceAll(PASTE_START, "").replaceAll(PASTE_END, "");
		// Anything else must be printable; control sequences are not text.
		const typed = [...text].filter((char) => char >= " " && char !== "\u007f").join("");
		if (typed && maxLength !== undefined && buffer.length + typed.length <= maxLength) {
			next = {
				...state,
				buffer: buffer.slice(0, caret) + typed + buffer.slice(caret),
				caret: caret + typed.length,
			};
		}
	}
	return { kind: "update", state: next, changed: next.buffer !== buffer || next.caret !== caret };
}
