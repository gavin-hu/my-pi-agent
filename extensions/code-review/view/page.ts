/**
 * The review's document: the rail, the diff, and the review's own controls.
 *
 * The diff is drawn by `lib/diff` — the one renderer both diff pages use — and
 * the page carries the review state as a JSON island; comments are painted by the
 * client from that island, so a comment body reaches the document as a
 * `textContent` write rather than as markup. Every file section names its path,
 * which is the anchor a comment's line number is read against.
 *
 * The shell is complete before the script runs: a slow frame shows the page it
 * read, not an empty one.
 */

import { renderDiffLines, type DiffGutter } from "../../../lib/diff/render.ts";
import type { DiffLine } from "../../../lib/diff/parse.ts";
import { detectLanguage } from "../../../lib/highlight.ts";
import { escapeHtml } from "../../../lib/escape.ts";
import { plural } from "../../../lib/format.ts";
import {
	appHead,
	baseAttribute,
	button,
	docHead,
	keysSheet,
	liveChip,
	pageFooter,
	pageSheet,
	reloadChip,
	tabTitle,
} from "../../../lib/web/index.ts";
import type { ReviewSnapshot } from "../git/diff.ts";
import type { Review, ReviewComment } from "../review/store.ts";
import { MAX_COMMENT_LENGTH, MAX_COMMENTS, MAX_QUOTE_LENGTH } from "../review/store.ts";
import { fileHref, newHref, presetHref } from "../links.ts";
import { REVIEW_PRESETS, presetTitle, type ReviewPreset, type ReviewScope } from "../scope.ts";
import { REVIEW_CSS, REVIEW_NARROW_PX } from "./styles.ts";
import { FILE_CLIENT_JS_PATH } from "./file-client.ts";
import { wrapButton } from "./wrap.ts";

/** What the client is told about the page; the island carries it as one value. */
export interface ReviewData {
	/** The mount prefix, `/review`, as the page's own script reads it. */
	base: string;
	/** The page's write credential. */
	token: string;
	/** The review's id, or `""` before the first write. */
	id: string;
	scope: ReviewScope;
	/** The preset naming that scope, when one does. */
	preset?: ReviewPreset;
	rev: string;
	label: string;
	comments: ReviewComment[];
	reviewed: string[];
	/**
	 * How many files the scope holds — not how many this page draws. A focused page renders one
	 * file and still speaks for the whole scope, so the count cannot come from the rail's rows.
	 */
	files: number;
	limits: { comments: number; body: number; quote: number };
	/** The width the rail folds at, which is also where the page wraps unless the reader said no. */
	narrow: number;
	/** The footer's first clause, built from whatever commits the snapshot holds. */
	comparison: string;
}

/** One page render's inputs. */
export interface ReviewPageInput {
	/** The mount prefix, `/review`. */
	base: string;
	/** The repository's name, which the header shows. */
	repo: string;
	/** The repository's path, which the name's hover carries. */
	root: string;
	token: string;
	snapshot: ReviewSnapshot;
	/** The preset the page was opened by, when one names it; a pair a reader typed has none. */
	preset?: ReviewPreset;
	/**
	 * One file to draw, by root-relative path: the whole scope is still read and its
	 * fingerprint still covers every file, so a focused page and the full page accept each
	 * other's writes. An unknown path draws the whole scope rather than an error.
	 */
	file?: string;
	review?: Review;
}

/** The kit's shortcut rows for this page. */
const REVIEW_KEYS = [
	{ keys: "?", label: "This sheet" },
	{ keys: "/", label: "Focus the file filter" },
	{ keys: ["j k", "↓ ↑"], label: "Next and previous line" },
	{ keys: "Shift", label: "Extend the range with a move or a click" },
	{ keys: "Enter", label: "Comment on the selected lines" },
	{ keys: "c", label: "Comment on the selected lines" },
	{ keys: "m", label: "Mark the current file reviewed" },
	{ keys: ["] [", "n p"], label: "Next and previous hunk — n p stay in this file" },
	{ keys: "w", label: "Toggle line wrapping" },
	{ keys: "Esc", label: "Close a composer, a dialog, or the sheet" },
];

/** The state a file wears in the rail and on its head. */
function fileState(rel: string, comments: readonly ReviewComment[], reviewed: ReadonlySet<string>): string {
	if (reviewed.has(rel)) return "reviewed";
	return comments.some((comment) => comment.rel === rel) ? "commented" : "new";
}

/** The word a file's own line says about its state. */
function stateWord(state: string): string {
	if (state === "reviewed") return "marked reviewed";
	// A file without a comment is not "unread": the page cannot know that. The `commented`
	// case never reaches here — a file with comments prints its count instead.
	return "no comment";
}

/** A comment count as words: the one number a row shows, and it says what it counts. */
function commentWords(count: number): string {
	return `${count} comment${count === 1 ? "" : "s"}`;
}

/**
 * What a row says about itself on its title, now that its own line does not spend one on the state.
 *
 * The count first, because it is the fact the row's paper cannot carry; the state second, and only
 * where the count would otherwise hide it. `stateWord`'s judgement survives in full — a file without
 * a comment is not "unread" — as the sentence a screen reader and a hover hear, rather than a third
 * line a reader sees. The client holds the same rule (`client.ts`'s `railNote`): a spliced body
 * cannot import, and the markup case and the browser case hold the two to one answer.
 */
function railNote(state: string, count: number): string {
	if (count === 0) return stateWord(state);
	return state === "reviewed" ? `${commentWords(count)}, marked reviewed` : commentWords(count);
}

/** A path split for the rail: its directory and its name. */
function splitPath(rel: string): { dir: string; name: string } {
	const cut = rel.lastIndexOf("/");
	return cut < 0 ? { dir: "", name: rel } : { dir: rel.slice(0, cut), name: rel.slice(cut + 1) };
}

/** One rail row. */
function railRow(
	file: ReviewSnapshot["files"][number],
	index: number,
	comments: readonly ReviewComment[],
	reviewed: ReadonlySet<string>,
): string {
	const state = fileState(file.rel, comments, reviewed);
	const count = comments.filter((comment) => comment.rel === file.rel).length;
	const { dir, name } = splitPath(file.rel);
	// The state is the title's, not a line's: a row that spends a line on its state is a file fewer
	// in a rail that is capped and scrolls (#817). A zero count hides its box rather than emptying
	// it, so no row is taller for having nothing to say.
	return `<a class="rv-rail" href="#rv-file-${index}" data-path="${escapeHtml(file.rel)}" data-state="${state}"${index === 0 ? ' aria-current="true"' : ""} title="${escapeHtml(file.rel)} — ${escapeHtml(railNote(state, count))}">
  <span class="rv-rail__mark" aria-hidden="true">${escapeHtml(file.status)}</span>
  <span><span class="rv-rail__line"><span class="rv-rail__name">${escapeHtml(name)}</span><span class="rv-rail__notes"${count === 0 ? " hidden" : ""}>${count === 0 ? "" : escapeHtml(commentWords(count))}</span></span><span class="rv-rail__dir" dir="rtl"><bdi>${escapeHtml(dir)}</bdi></span></span>
  <span class="rv-rail__meta"><span class="rv-add">+${file.add}</span><span class="rv-del">−${file.del}</span></span>
</a>`;
}

/**
 * The way back from a focused page: the scope alone, never `?file=`, so the reader lands on
 * the review they were already in — the held page, its comments and its token — instead of a
 * page that still names the file. It is not a `.rv-rail` row: the client's rail helpers are
 * keyed on those, and a link among them that names no file would be counted as one.
 */
function backToAll(current: { scope: ReviewScope; preset?: ReviewPreset }, total: number): string {
	return `<p class="rv-side__back"><a class="bf-btn" id="rv-all-files" href="${escapeHtml(newHref(current.scope, current.preset))}">all ${total} file${total === 1 ? "" : "s"}</a></p>`;
}

/** What one file's section needs: the review it is drawn in, and the state it wears. */
interface FileSectionInput {
	file: ReviewSnapshot["files"][number];
	index: number;
	comments: readonly ReviewComment[];
	reviewed: ReadonlySet<string>;
	scope: ReviewScope;
	preset?: ReviewPreset;
	/** Whether this is the page's last section, which is the one that carries the tail's room. */
	last: boolean;
	/** The page's token, so the whole-file link can hold the page it belongs to. */
	token: string;
}

/** One file's head, its diff, the two notes a cap leaves, and — last — the room the tail needs. */
function fileSection(input: FileSectionInput): string {
	const { file, index, comments, reviewed, scope, preset, last, token } = input;
	const state = fileState(file.rel, comments, reviewed);
	const count = comments.filter((comment) => comment.rel === file.rel).length;
	const { dir, name } = splitPath(file.rel);
	const head = `<div class="rv-file__head">
  <span class="rv-file__mark" aria-hidden="true">${escapeHtml(file.status)}</span>
  <span class="rv-file__path"><span class="rv-file__dir">${escapeHtml(dir ? `${dir}/` : "")}</span>${escapeHtml(name)}</span>
  <span class="rv-file__stats"><span class="rv-add">+${file.add}</span><span class="rv-del">−${file.del}</span></span>
  <span class="rv-file__acts">
    <a class="bf-btn" href="${escapeHtml(fileHref(file.rel, scope, preset, token))}" title="Read this file's whole text">view file</a>
    <span class="bf-tag" data-count>${count === 0 ? escapeHtml(stateWord(state)) : `${count} comment${count === 1 ? "" : "s"}`}</span>
    <label class="rv-file__check"><input type="checkbox" data-reviewed="${escapeHtml(file.rel)}" aria-label="Mark ${escapeHtml(file.rel)} reviewed"${reviewed.has(file.rel) ? " checked" : ""}> reviewed</label>
  </span>
</div>`;
	const notes: string[] = [];
	// The header already names the path and the stats, so the diff's own `diff --git`,
	// `index`, and `---`/`+++` lines are the page repeating itself.
	const rows = file.lines.filter((line) => line.kind !== "meta");
	if (file.unmerged) {
		notes.push('<p class="rv-file__note">This file is unmerged — resolve it in your tree, then reload the page.</p>');
	} else if (file.binary) {
		notes.push('<p class="rv-file__note">A binary or unreadable change; there is no text diff for it.</p>');
	} else if (rows.length === 0) {
		notes.push('<p class="rv-file__note">No text change is shown for this file.</p>');
	} else if (file.truncated) {
		notes.push(`<p class="rv-file__note">Showing the first ${rows.length} diff lines for this file.</p>`);
	}
	const body = rows.length === 0 ? "" : diffPre({ rel: file.rel, lines: rows });
	// The last section carries the room a row in the last screenful needs to reach the reading
	// line. It is the section's own child, not a sibling, so the file stays `:last-child` — the
	// bar's inset rule and the cases that query it keep the box they measure (#930).
	const tail = last && body !== "" ? '\n<div class="rv-tail" id="rv-tail" aria-hidden="true"></div>' : "";
	return `<section class="rv-file" id="rv-file-${index}" data-path="${escapeHtml(file.rel)}" data-state="${state}">
${head}
${notes.join("\n")}
${body}${tail}
</section>`;
}

/**
 * The `<pre>` a diff or a whole file is drawn in.
 *
 * One body for the classes the renderer's rules and the page's stylesheet both read, and for
 * the one `<code>` the rendered rows go inside. A page that draws rows supplies those rules,
 * so a second copy of the opening tag is how the class list drifts from them — and the file
 * view is that second page.
 */
export function diffPre(options: {
	rel: string;
	lines: DiffLine[];
	/** One column for a whole file, two sides for a comparison. */
	gutter?: DiffGutter;
	/** Extra attributes for the pre, their values escaped here. */
	attrs?: Readonly<Record<string, string>>;
	/** One extra class, after the three every diff pre wears. */
	className?: string;
}): string {
	const extra = Object.entries(options.attrs ?? {})
		.map(([key, value]) => ` ${key}="${escapeHtml(value)}"`)
		.join("");
	const klass =
		options.className === undefined ? "bf-code bf-diff rv-diff" : `bf-code bf-diff rv-diff ${options.className}`;
	const inner = renderDiffLines(options.lines, detectLanguage(options.rel), { gutter: options.gutter ?? "diff" });
	return `<pre class="${klass}" data-path="${escapeHtml(options.rel)}"${extra}><code>${inner}</code></pre>`;
}

/** The scope switch: one tab per preset, the one this page was opened by pressed. */
function scopeSegments(current: { scope: ReviewScope; preset?: ReviewPreset }): string {
	return `<div class="bf-tabs" role="group" aria-label="What the diff compares">${REVIEW_PRESETS.map(
		(preset) =>
			`<a class="bf-tabs__item" href="${escapeHtml(presetHref(preset))}" role="tab" aria-selected="${preset === current.preset}" title="${escapeHtml(presetTitle(preset))}">${preset}</a>`,
	).join("")}</div>`;
}

/**
 * The footer's comparison clause: both shas when both ends name a commit, the label alone
 * otherwise. Never `undefined` — the absent form is a comparison with no commit at one end
 * (the index or the working tree), not a hole in the sentence.
 */
export function comparisonLine(snapshot: Pick<ReviewSnapshot, "label" | "fromSha" | "toSha">): string {
	if (snapshot.fromSha === undefined || snapshot.toSha === undefined) return snapshot.label;
	return `${snapshot.fromSha} → ${snapshot.toSha}`;
}

/** The island: the review as data, with `<` escaped so a body cannot end the script. */
export function reviewData(input: ReviewPageInput): ReviewData {
	return {
		base: input.base,
		token: input.token,
		id: input.review?.id ?? "",
		scope: input.snapshot.scope,
		...(input.preset === undefined ? {} : { preset: input.preset }),
		rev: input.snapshot.fingerprint,
		label: input.snapshot.label,
		comments: input.review?.comments ?? [],
		reviewed: input.review?.reviewed ?? [],
		files: input.snapshot.files.length,
		limits: { comments: MAX_COMMENTS, body: MAX_COMMENT_LENGTH, quote: MAX_QUOTE_LENGTH },
		narrow: REVIEW_NARROW_PX,
		comparison: comparisonLine(input.snapshot),
	};
}

/** The document, ready to serve. */
export function renderReviewPage(input: ReviewPageInput): string {
	const { base, snapshot } = input;
	const comments = input.review?.comments ?? [];
	const reviewed = new Set(input.review?.reviewed ?? []);
	const drafts = comments.filter((comment) => comment.state === "draft");
	const done = reviewed.size;
	const data = reviewData(input);
	const island = JSON.stringify(data).replaceAll("<", "\\u003c");
	const all = snapshot.files;
	const focused = input.file === undefined ? undefined : all.find((file) => file.rel === input.file);
	const files = focused === undefined ? all : [focused];
	const stale = input.review !== undefined && input.review.rev !== snapshot.fingerprint;
	// One home per fact: the rail's head carries everything about files (shown/total, the totals and
	// how far the review has got), the footer carries only the comparison, and the draft count is on
	// the Send button. The facts zone is the page's state, which is two things now: the stream it
	// follows, and the way out of a page the tree moved under — the live chip took its place beside
	// the reload because the kit puts the live state in the header, and a sixth slot for one cell
	// would be a row for a fact this row already holds.
	const facts = `${liveChip({ id: "rv-live", label: "connecting…" })}${reloadChip({ title: "The diff moved — reload the page" })}`;
	const controls = `<div class="bf-app__group">
    ${scopeSegments({ scope: snapshot.scope, preset: input.preset })}
  </div>
  <div class="bf-app__actions">
    ${wrapButton({ pressed: false })}
    ${button({ label: "copy all", id: "rv-copy", title: "Copy every comment as Markdown" })}
    ${button({ label: `Send feedback ${drafts.length}`, variant: "primary", id: "rv-send", title: "Send these comments back to the session", attrs: { "data-count": String(drafts.length) } })}
  </div>`;
	const main =
		files.length === 0
			? `<div class="bf-empty"><p class="bf-empty__title">No changes in this scope.</p><p class="bf-empty__sub">Nothing differs between ${escapeHtml(snapshot.label)} and the tree. Switch the scope, or edit something first.</p></div>`
			: files
					.map((file, index) =>
						fileSection({
							file,
							index,
							comments,
							reviewed,
							scope: snapshot.scope,
							...(input.preset === undefined ? {} : { preset: input.preset }),
							last: index === files.length - 1,
							token: input.token,
						}),
					)
					.join("\n");
	const omitted =
		snapshot.omitted > 0
			? `<p class="rv-banner" role="status"><b>${snapshot.omitted} more file${snapshot.omitted === 1 ? "" : "s"}</b> changed in this scope — the page lists the first ${all.length}. Review the rest in a narrower scope.</p>`
			: "";
	const banner = stale
		? `<p class="rv-banner" role="status"><b>The diff moved</b> since this review started — comments stay on the line they named.</p>`
		: "";
	return `<!doctype html>
<html lang="en"${baseAttribute(base)}>
<head>
${docHead({ title: tabTitle("review", input.repo, drafts.length > 0 ? plural(drafts.length, "draft") : undefined), css: pageSheet(REVIEW_CSS), base })}
</head>
<body class="bf-app">
<h1 class="sr-only">review — a code review of ${escapeHtml(input.repo)}</h1>
<a class="skip" href="#rv-main">Skip to the diff</a>
${appHead({
	product: "review",
	subject: { id: "rv-repo", label: input.repo, title: input.root },
	facts,
	controls,
})}
<div class="bf-app__body">
  <details class="bf-app__sidebar rv-sidebar" open>
    <summary class="bf-panel__summary">Files</summary>
    <aside class="bf-panel rv-side">
      <div class="rv-side-top">
        <label class="bf-field"><span class="bf-field__prompt" aria-hidden="true"></span><span class="sr-only">Filter files</span><input class="bf-input" id="rv-filter" type="search" placeholder="filter files" autocomplete="off"></label>
        <p class="bf-tabs--view__label" id="rv-view-label">Show</p>
        <div class="bf-tabs bf-tabs--view" role="group" aria-labelledby="rv-view-label" id="rv-view">
          <button type="button" class="bf-tabs__item" id="rv-view-all" data-only="false" aria-pressed="true">All</button>
          <button type="button" class="bf-tabs__item" id="rv-view-commented" data-only="true" aria-pressed="false">Commented</button>
        </div>
        <span class="bf-tag bf-tag--mono rv-count" id="rv-file-count" aria-live="polite">${files.length} of ${all.length} files</span>
      </div>
      <div class="rv-side-scroll">
        ${focused === undefined ? "" : backToAll({ scope: snapshot.scope, preset: input.preset }, all.length)}
        <div class="rv-side-head"><span>${focused === undefined ? "changed" : "changed in scope"}</span><span class="rv-progress" id="rv-progress" aria-live="polite">${done} of ${all.length} reviewed</span><span id="rv-totals">+${snapshot.insertions} −${snapshot.deletions}</span></div>
        <nav class="rv-files" id="rv-rail" aria-label="Changed files">${files.map((file, index) => railRow(file, index, comments, reviewed)).join("\n")}</nav>
        <p class="bf-note" id="rv-rail-empty" hidden><span id="rv-rail-empty-text"></span> <button type="button" class="bf-btn bf-btn--sm" id="rv-rail-clear">Clear filter</button></p>
      </div>
    </aside>
  </details>
  <main class="bf-app__main rv-main" id="rv-main" tabindex="-1">
    <div class="rv-files-scroll" id="rv-diff">
      <p class="rv-filter-note" id="rv-filter-note" hidden><span id="rv-filter-note-text"></span> <button type="button" class="bf-btn" id="rv-filter-clear">Clear</button></p>
      ${banner}
      <div class="rv-orphans" id="rv-orphans" hidden>
        <p class="rv-orphans__head" id="rv-orphans-head" role="status"></p>
        <div class="rv-orphans__list" id="rv-orphans-list"></div>
      </div>
      ${omitted}
      ${main}
    </div>
  </main>
</div>
${pageFooter({ facts: comparisonLine(snapshot), factsId: "rv-facts" })}

<div class="rv-selbar" id="rv-selbar" data-open="false" role="toolbar" aria-label="Selected lines">
  <span class="rv-selbar__ref" id="rv-selbar-ref"></span>
  <button type="button" class="bf-btn" id="rv-sel-comment">comment</button>
  <button type="button" class="bf-btn" id="rv-sel-copy" title="Copy as path:line">copy ref</button>
  <button type="button" class="bf-btn bf-btn--ghost" id="rv-sel-clear" title="Clear selection">×</button>
</div>

<div class="rv-toast" id="rv-toast" role="status"></div>

<div class="bf-dialog" id="rv-send-dialog" hidden>
  <div class="bf-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="rv-send-title">
    <div class="bf-dialog__head"><h2 id="rv-send-title">Send comments to the session</h2><span class="bf-spacer"></span><button type="button" class="bf-btn" id="rv-send-close">Close</button></div>
    <div class="bf-dialog__body">
      <p class="bf-dialog__hint">They arrive as one message; the model reads them at its next turn. Nothing is written to your tree.</p>
      <div class="rv-dialog-list" id="rv-send-list"></div>
    </div>
    <div class="bf-dialog__actions">
      <button type="button" class="bf-btn" id="rv-send-cancel">Cancel</button>
      <button type="button" class="bf-btn bf-btn--primary" id="rv-send-confirm">Send to pi</button>
    </div>
  </div>
</div>

${keysSheet(REVIEW_KEYS)}
<script type="application/json" id="rv-data">${island}</script>
<script src="${escapeHtml(base)}/client.js" defer></script>
</body>
</html>`;
}

/**
 * The document a review-served page without a rail renders: the file view, and a refusal.
 *
 * One envelope, because the two pages carry the same head, footer and one script, and neither
 * serves the key sheet. The zones the header and footer draw stay the page's own: what this
 * owns is the pair of facts those two pages must not disagree about — `keys: false` for a
 * sheet they do not include, and the file view's client, which is what makes the theme toggle
 * on either page a control that does something.
 */
export function renderReviewDocument(options: {
	base: string;
	/** The page's subject: the tab title's, the heading's, and the identity row's one label. */
	subject: string;
	/** The header's facts zone, as trusted markup. */
	facts: string;
	/** The footer's one line. */
	footer: string;
	/** The page's own control row, when it has one. */
	controls?: string;
	/** The page's main content, already markup. */
	main: string;
}): string {
	const { base, subject } = options;
	return `<!doctype html>
<html lang="en"${baseAttribute(base)}>
<head>
${docHead({ title: tabTitle("review", subject), css: pageSheet(REVIEW_CSS), base })}
</head>
<body class="bf-app">
<h1 class="sr-only">review — ${escapeHtml(subject)}</h1>
${appHead({
	product: "review",
	subject: { label: subject, title: subject },
	facts: options.facts,
	keys: false,
	...(options.controls === undefined ? {} : { controls: options.controls }),
})}
<main class="bf-app__main" id="rv-main">
${options.main}
</main>
${pageFooter({ facts: options.footer })}
<script src="${escapeHtml(base)}${FILE_CLIENT_JS_PATH}" defer></script>
</body>
</html>`;
}

/** The document a scope with no answer serves: the reason, and how to leave it. */
export function renderReviewProblem(base: string, title: string, message: string): string {
	return renderReviewDocument({
		base,
		subject: title,
		facts: "",
		footer: "review",
		main: `  <div class="bf-empty">
    <p class="bf-empty__title">${escapeHtml(title)}</p>
    <p class="bf-empty__sub">${escapeHtml(message)}</p>
    <p class="bf-empty__sub"><a href="${escapeHtml(base)}/new">Back to the review</a></p>
  </div>`,
	});
}
