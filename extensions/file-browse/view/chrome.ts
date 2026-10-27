/**
 * The header chrome for the browse pages.
 *
 * The chips the toolbar carries — the git branch, the change totals, the live
 * connection state — and the footer's live line. Everything here is pure string
 * building over an escaped view model: a branch name, a count, and a status word
 * are all text a repository can choose, so each one crosses `escapeHtml` before
 * it reaches the page. The page shell and the page bodies stay in `html.ts`.
 */

import { escapeHtml } from "../../../lib/escape.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import type { GitStatus } from "../git/git.ts";
import type { ChangeIndex } from "../live/live.ts";

/** The header's git chip: the branch, or the detached head; changes are the changes chip's job. */
export function renderGit(git: GitStatus | undefined): string {
	if (!git) return "";
	const name = git.branch ?? git.head;
	if (!name) return "";
	const glyph = git.branch ? GLYPHS.branch : GLYPHS.detached;
	const aria = git.branch ? `git branch ${git.branch}` : `git detached at ${git.head ?? ""}`;
	return `<span class="bf-chip browse-git" title="${escapeHtml(aria)}" aria-label="${escapeHtml(aria)}"><span class="browse-git__glyph" aria-hidden="true">${escapeHtml(glyph)}</span><span class="browse-git__name">${escapeHtml(name)}</span></span>`;
}

/** The live chrome a page renders: how often its stream is sent a frame. */
export interface LivePage {
	intervalMs: number;
	/** Root-relative folder the page listed; absent on a page with no listing to check. */
	dir?: string;
	/** Revision of the names that listing drew, which the reload control compares against. */
	rev?: string;
}

/**
 * The header's live controls: the connection chip, and the reload control the
 * client reveals once the folder the page drew has changed on disk. Both start
 * hidden, so a page with JS off — or with live status disabled — never shows a
 * state or a control it cannot keep true; the reload control is not rendered at
 * all when the page has no listing revision to compare.
 *
 * The chip is deliberately not a `role="status"` region: the header is where a
 * reader looks for the page's state, not a place to announce every change to it.
 */
export function renderLiveChrome(live: LivePage | undefined): string {
	if (!live) return "";
	const rev =
		live.rev === undefined ? "" : ` data-dir="${escapeHtml(live.dir ?? "")}" data-rev="${escapeHtml(live.rev)}"`;
	const chip = `<span class="bf-chip bf-chip--accent browse-live" id="live-state" title="Live status from the browse server" data-interval="${live.intervalMs}"${rev} hidden><span class="browse-live__glyph" aria-hidden="true">●</span><span class="browse-live__text">connecting</span></span>`;
	if (live.rev === undefined) return chip;
	return `${chip}<button type="button" class="bf-chip bf-chip--warn browse-reload" id="reload-hint" title="This folder changed on disk" hidden>⟳ reload</button>`;
}

/**
 * The footer's live line, hidden until the first frame: uptime and requests are
 * server facts the rendered page does not know at build time.
 */
export function renderLiveStatus(): string {
	return `<span class="browse-live-line" id="live-status" hidden></span>`;
}

/**
 * The header's changes chip, linking to the diff overview. With live status on,
 * a hidden shell is always rendered so the chip can appear and disappear as the
 * working tree changes, without the client inserting elements into the header.
 */
export function renderChanges(summary: ChangeIndex | undefined, live: LivePage | undefined): string {
	const count = summary?.count ?? 0;
	if (count <= 0) {
		return live
			? `<a class="bf-chip browse-diff" id="browse-changes" href="/diff" title="View uncommitted changes" hidden></a>`
			: "";
	}
	const label = `${count} change${count === 1 ? "" : "s"}`;
	const insertions = summary?.insertions ?? 0;
	const deletions = summary?.deletions ?? 0;
	const totals =
		insertions + deletions > 0
			? ` <span class="browse-diff-totals"><span class="browse-diff-add">+${insertions}</span> <span class="browse-diff-del">−${deletions}</span></span>`
			: "";
	const aria = `${label} against HEAD${insertions + deletions > 0 ? `, ${insertions} insertions and ${deletions} deletions` : ""}`;
	return `<a class="bf-chip browse-diff" id="browse-changes" href="/diff" title="View uncommitted changes" aria-label="${escapeHtml(aria)}"><span class="browse-diff__dot" aria-hidden="true">●</span>${escapeHtml(label)}${totals}</a>`;
}
