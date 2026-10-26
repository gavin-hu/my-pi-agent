/**
 * The review page's keyboard, and the one piece of pointer state a key acts on.
 *
 * The ninth capability out of the review client's template literal — and the last one, by
 * decision: what is left in the bundle after this is wiring (which listener to attach, the
 * frame stream, the boot order), and a rule about which key does what does not belong in a
 * list of `addEventListener` calls.
 *
 * Two rules live here:
 *
 * - **Esc peels one layer.** The shortcut sheet owns its own Esc (the shared dialog runtime
 *   captures it), so this peels the composer first and closes the review second, which is
 *   the order a reader pressing it twice expects.
 * - **The selection a reader makes is the quote the next comment carries.** The rail button
 *   collapses the selection when it is pressed, so the text is remembered on `mouseup` and
 *   read again at click time; a block with a composer open is not a selection to quote.
 */

import type { ClientNode } from "../../lib/web/client-runtime.ts";
import type { ReviewRole } from "./types.ts";

/** What a key may do: one callback per action the page owns. */
export interface KeyDeps {
	/** Whether a composer is open, and how to close it. */
	composerOpen(): boolean;
	closeComposer(): void;
	/** Close the review without saving: the owner's, and a no-op for a reviewer. */
	cancel(): void;
	/** The shortcut sheet: whether it is open (it then owns the keyboard) and its toggle. */
	sheetOpen(): boolean;
	toggleSheet(): void;
	/** Walk the blocks by one, in the direction the key names. */
	moveActive(delta: number): void;
	/** Comment on the block the keyboard is on. */
	commentOnActive(): void;
	/** Approve, through its confirmation; and the two writes `s` can stand for. */
	askApprove(): void;
	save(): void;
	postComments(): void;
	/** Whether a control exists for the key to stand for. */
	hasSaveControl(): boolean;
	hasApproveControl(): boolean;
	/** Whether the key landed in a field, where every key is text. */
	typing(target: unknown): boolean;
}

/** The keys a reader can press, as far as this page is concerned. */
export interface KeyEvent {
	key: string;
	metaKey?: boolean;
	ctrlKey?: boolean;
	altKey?: boolean;
	target?: unknown;
	preventDefault(): void;
}

/** What the page offers, for the rows whose sentence or availability depends on it. */
export interface KeySurface {
	/** Whose page it is: the owner saves and closes, a reviewer posts. */
	role: ReviewRole;
	/** Whether this review may approve the plan. */
	canApprove: boolean;
}

/**
 * One key the page answers and documents.
 *
 * The bindings, the shortcut sheet and the sidebar hint all read this table, because
 * three hand-kept lists of the same keys is how a sheet comes to name a key the page no
 * longer answers. The two layer keys — `Esc` and `?` — carry no `run`: they are handled
 * before the table, because they work while a composer or the sheet owns the keyboard,
 * and they are listed so the sheet documents them with the rest.
 */
export interface WebKey {
	/** Stable id: the sheet's order, and what a test names. */
	id: "approve" | "blocks" | "comment" | "add" | "settle" | "close" | "sheet";
	/** The keys as the sheet prints them; the same strings the handler matches. */
	keys: readonly string[];
	/** The sheet's sentence on this page. */
	label(surface: KeySurface): string;
	/** The words the sidebar hint adds after the key, if it names the key at all. */
	hint?(surface: KeySurface): string;
	/** Whether the page offers it; a key nobody can press is not documented. */
	offered?(surface: KeySurface): boolean;
	/** What the key does, for the keys this handler owns; `key` is which binding fired. */
	run?(deps: KeyDeps, key: string): void;
}

/** The page's keys, in the order the sheet lists them. */
export const WEB_KEYS: readonly WebKey[] = [
	{
		id: "approve",
		keys: ["a"],
		offered: (surface) => surface.canApprove,
		label: () => "Approve and run the plan",
		hint: () => "to approve",
		run: (deps) => deps.askApprove(),
	},
	{
		id: "blocks",
		keys: ["j", "k"],
		label: () => "Next and previous block",
		hint: () => "to move",
		// The block keys share a row: `j` walks forward, `k` back.
		run: (deps, key) => deps.moveActive(key === "k" ? -1 : 1),
	},
	{
		id: "comment",
		keys: ["c"],
		label: () => "Comment on the current block",
		hint: () => "to comment",
		run: (deps) => deps.commentOnActive(),
	},
	{
		id: "add",
		keys: ["Enter"],
		label: () => "Add the comment you are writing",
	},
	{
		id: "settle",
		keys: ["s"],
		label: (surface) =>
			surface.role === "owner" ? "Save feedback and return to Pi" : "Post your comments to the plan",
		hint: (surface) => (surface.role === "owner" ? "to save" : "to post"),
		run: (deps) => (deps.hasSaveControl() ? deps.save() : deps.postComments()),
	},
	{
		id: "close",
		keys: ["Esc"],
		label: (surface) =>
			surface.role === "owner" ? "Close the composer, the sheet, or the review" : "Close the composer or this sheet",
	},
	{
		id: "sheet",
		keys: ["?"],
		label: () => "Toggle this sheet",
		hint: () => "for all shortcuts",
	},
];

/** The rows this page offers, in sheet order. */
export function keyRows(surface: KeySurface): WebKey[] {
	return WEB_KEYS.filter((row) => row.offered === undefined || row.offered(surface));
}

/** The surface a handler sees, read off the controls it was given. */
function surfaceOf(deps: KeyDeps): KeySurface {
	return { role: deps.hasSaveControl() ? "owner" : "reviewer", canApprove: deps.hasApproveControl() };
}

/**
 * Handle one keydown.
 *
 * A modified key is never a shortcut: `ctrl+s` belongs to the browser. A field owns the
 * keyboard while it has focus, and so does the shortcut sheet while it is open. The
 * content keys come from {@link WEB_KEYS}, so the key that acts and the key the sheet
 * documents cannot part company.
 */
export function handleKey(event: KeyEvent, deps: KeyDeps): void {
	if (event.key === "Escape") {
		// The sheet owns its own Esc; this peels the composer, then the review.
		if (deps.composerOpen()) {
			deps.closeComposer();
			return;
		}
		deps.cancel();
		return;
	}
	if (deps.typing(event.target)) return;
	if (event.metaKey || event.ctrlKey || event.altKey) return;
	if (event.key === "?") {
		event.preventDefault();
		deps.toggleSheet();
		return;
	}
	// While the shortcut sheet is open it owns the keyboard.
	if (deps.sheetOpen()) return;
	const surface = surfaceOf(deps);
	for (const row of keyRows(surface)) {
		if (row.run === undefined || !row.keys.includes(event.key)) continue;
		event.preventDefault();
		row.run(deps, event.key);
		return;
	}
}

/** What remembering a selection reads, and where it puts it. */
export interface QuoteDeps {
	planEl: ClientNode | null;
	/** A settled review takes no more comments, so it remembers no selection. */
	settled(): boolean;
	/** The text a reader selected inside one block. */
	selectionIn(wrap: ClientNode): string;
	/** Remember it, or forget the last one when the release selected nothing. */
	setPending(quote: { wrap: ClientNode; quote: string } | null): void;
}

/**
 * Remember the text a reader selected, so the rail button can still quote it.
 *
 * A release outside a block, or inside a block whose composer is open, clears what was
 * remembered: the next click must not quote text from somewhere the reader has left.
 */
export function rememberSelection(target: unknown, deps: QuoteDeps): void {
	if (!deps.planEl || deps.settled()) return;
	const node = target as { closest?: (selector: string) => ClientNode | null } | null;
	const wrap = node && typeof node.closest === "function" ? node.closest(".bf-block") : null;
	const quote = wrap && !wrap.querySelector(".bf-composer") ? deps.selectionIn(wrap) : "";
	deps.setPending(wrap && quote ? { wrap, quote } : null);
}

/** The keymap and the quote rule as source, for the client bundle. */
export const WEB_KEYS_JS = [handleKey, rememberSelection].map(String).join("\n\n");
