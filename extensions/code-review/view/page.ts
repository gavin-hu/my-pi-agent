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

import { renderDiffLines } from "../../../lib/diff/render.ts";
import { detectLanguage, type HighlightLanguage } from "../../../lib/highlight.ts";
import { escapeHtml } from "../../../lib/escape.ts";
import { plural } from "../../../lib/format.ts";
import {
	appHead,
	baseAttribute,
	button,
	docHead,
	keysSheet,
	pageFooter,
	pageSheet,
	reloadChip,
	tabTitle,
} from "../../../lib/web/index.ts";
import type { ReviewSnapshot } from "../git/diff.ts";
import type { Review, ReviewComment } from "../review/store.ts";
import { MAX_COMMENT_LENGTH, MAX_COMMENTS, MAX_QUOTE_LENGTH } from "../review/store.ts";
import { fileHref, newHref } from "../links.ts";
import { REVIEW_SCOPES, scopeArgs, type ReviewScope } from "../scope.ts";
import { REVIEW_CSS, REVIEW_NARROW_PX } from "./styles.ts";

/** What the client is told about the page; the island carries it as one value. */
export interface ReviewData {
	/** The mount prefix, `/review`, as the page's own script reads it. */
	base: string;
	/** The page's write credential. */
	token: string;
	/** The review's id, or `""` before the first write. */
	id: string;
	scope: ReviewScope;
	rev: string;
	label: string;
	comments: ReviewComment[];
	reviewed: string[];
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
	{ keys: "Enter", label: "Comment on the cursor line" },
	{ keys: "c", label: "Comment on the cursor line" },
	{ keys: "m", label: "Mark the current file reviewed" },
	{ keys: ["] n", "[ p"], label: "Next and previous hunk" },
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
	const note = count === 0 ? stateWord(state) : `${count} comment${count === 1 ? "" : "s"}`;
	return `<a class="rv-rail" href="#rv-file-${index}" data-path="${escapeHtml(file.rel)}" data-state="${state}"${index === 0 ? ' aria-current="true"' : ""} title="${escapeHtml(file.rel)}">
  <span class="rv-rail__mark" aria-hidden="true">${escapeHtml(file.status)}</span>
  <span><span class="rv-rail__name">${escapeHtml(name)}</span><span class="rv-rail__dir" dir="rtl"><bdi>${escapeHtml(dir)}</bdi></span><span class="rv-rail__notes">${escapeHtml(note)}</span></span>
  <span class="rv-rail__meta"><span class="rv-add">+${file.add}</span><span class="rv-del">−${file.del}</span></span>
</a>`;
}

/**
 * The way back from a focused page: the scope alone, never `?file=`, so the reader lands on
 * the review they were already in — the held page, its comments and its token — instead of a
 * page that still names the file. It is not a `.rv-rail` row: the client's rail helpers are
 * keyed on those, and a link among them that names no file would be counted as one.
 */
function backToAll(scope: ReviewScope, total: number): string {
	return `<p class="rv-side__back"><a class="bf-btn" id="rv-all-files" href="${escapeHtml(newHref(scope))}">all ${total} file${total === 1 ? "" : "s"}</a></p>`;
}

/** One file's head, its diff, and the two notes a cap leaves. */
function fileSection(
	file: ReviewSnapshot["files"][number],
	index: number,
	comments: readonly ReviewComment[],
	reviewed: ReadonlySet<string>,
	scope: ReviewScope,
): string {
	const state = fileState(file.rel, comments, reviewed);
	const count = comments.filter((comment) => comment.rel === file.rel).length;
	const { dir, name } = splitPath(file.rel);
	const head = `<div class="rv-file__head">
  <span class="rv-file__mark" aria-hidden="true">${escapeHtml(file.status)}</span>
  <span class="rv-file__path"><span class="rv-file__dir">${escapeHtml(dir ? `${dir}/` : "")}</span>${escapeHtml(name)}</span>
  <span class="rv-file__stats"><span class="rv-add">+${file.add}</span><span class="rv-del">−${file.del}</span></span>
  <span class="rv-file__acts">
    <a class="bf-btn" href="${escapeHtml(fileHref(file.rel, scope))}" title="Read this file's whole text">view file</a>
    <span class="bf-tag" data-count>${count === 0 ? escapeHtml(stateWord(state)) : `${count} comment${count === 1 ? "" : "s"}`}</span>
    <label class="rv-file__check"><input type="checkbox" data-reviewed="${escapeHtml(file.rel)}" aria-label="Mark ${escapeHtml(file.rel)} reviewed"${reviewed.has(file.rel) ? " checked" : ""}> reviewed</label>
  </span>
</div>`;
	const notes: string[] = [];
	// The header already names the path and the stats, so the diff's own `diff --git`,
	// `index`, and `---`/`+++` lines are the page repeating itself.
	const rows = file.lines.filter((line) => line.kind !== "meta");
	if (file.binary) {
		notes.push('<p class="rv-file__note">A binary or unreadable change; there is no text diff for it.</p>');
	} else if (rows.length === 0) {
		notes.push('<p class="rv-file__note">No text change is shown for this file.</p>');
	} else if (file.truncated) {
		notes.push(`<p class="rv-file__note">Showing the first ${rows.length} diff lines for this file.</p>`);
	}
	const body =
		rows.length === 0
			? ""
			: `<pre class="bf-code bf-diff rv-diff" data-path="${escapeHtml(file.rel)}"><code>${renderDiffLines(rows, languageOf(file.rel))}</code></pre>`;
	return `<section class="rv-file" id="rv-file-${index}" data-path="${escapeHtml(file.rel)}" data-state="${state}">
${head}
${notes.join("\n")}
${body}
</section>`;
}

/** The language a path's diff is highlighted in, when the tokenizer knows it. */
function languageOf(rel: string): HighlightLanguage | undefined {
	return detectLanguage(rel);
}

/** The scope switch: one link per comparison, the current one pressed. */
function scopeSegments(scope: ReviewScope): string {
	return `<div class="bf-tabs" role="group" aria-label="What the diff compares">${REVIEW_SCOPES.map(
		(option) =>
			`<a class="bf-tabs__item" href="${escapeHtml(newHref(option))}" role="tab" aria-selected="${option === scope}" title="${escapeHtml(scopeArgs(option, "").title)}">${option}</a>`,
	).join("")}</div>`;
}

/**
 * The footer's comparison clause, from whatever commits the snapshot holds: both shas name the
 * two ends, a head alone names the side it has, and neither leaves the comparison's own label.
 * Never `undefined` — the absent form is a scope with no commit to name (a fresh repository's
 * staged or working tree), not a hole in the sentence.
 */
export function comparisonLine(snapshot: Pick<ReviewSnapshot, "label" | "head" | "baseSha">): string {
	const head = snapshot.head === undefined ? "" : `HEAD ${snapshot.head}`;
	const base = snapshot.baseSha === undefined ? "" : `${snapshot.label.split("...")[0] ?? ""} ${snapshot.baseSha}`;
	if (base && head) return `${base} → ${head}`;
	if (head) return `${snapshot.label} · ${head}`;
	return snapshot.label;
}

/** The island: the review as data, with `<` escaped so a body cannot end the script. */
export function reviewData(input: ReviewPageInput): ReviewData {
	return {
		base: input.base,
		token: input.token,
		id: input.review?.id ?? "",
		scope: input.snapshot.scope,
		rev: input.snapshot.fingerprint,
		label: input.snapshot.label,
		comments: input.review?.comments ?? [],
		reviewed: input.review?.reviewed ?? [],
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
	// The header states no fact the footer owns: the comparison, the counts and the progress are the
	// footer's one line (lib/web/README.md), and the draft count is on the Send button. What is left
	// here is the way out of a page the tree moved under.
	const facts = reloadChip({ title: "The diff moved — reload the page" });
	const controls = `<div class="bf-app__group">
    ${scopeSegments(snapshot.scope)}
  </div>
  <div class="bf-app__group rv-actions">
    ${button({ label: "wrap", id: "rv-wrap", pressed: false, title: "Toggle line wrapping" })}
    ${button({ label: "copy all", id: "rv-copy", title: "Copy every comment as Markdown" })}
    ${button({ label: `Send feedback ${drafts.length}`, variant: "primary", id: "rv-send", title: "Send these comments back to the session", attrs: { "data-count": String(drafts.length) } })}
  </div>`;
	const main =
		files.length === 0
			? `<div class="bf-empty"><p class="bf-empty__title">No changes in this scope.</p><p class="bf-empty__sub">Nothing differs between ${escapeHtml(snapshot.label)} and the tree. Switch the scope, or edit something first.</p></div>`
			: files.map((file, index) => fileSection(file, index, comments, reviewed, snapshot.scope)).join("\n");
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
        <p class="rv-view__label" id="rv-view-label">Show</p>
        <div class="bf-tabs rv-view" role="group" aria-labelledby="rv-view-label" id="rv-view">
          <button type="button" class="bf-tabs__item" id="rv-view-all" data-only="false" aria-pressed="true">All</button>
          <button type="button" class="bf-tabs__item" id="rv-view-commented" data-only="true" aria-pressed="false">Commented</button>
        </div>
        <span class="bf-tag bf-tag--mono rv-count" id="rv-file-count" aria-live="polite">${files.length} of ${all.length} files</span>
      </div>
      <div class="rv-side-scroll">
        ${focused === undefined ? "" : backToAll(snapshot.scope, all.length)}
        <div class="rv-side-head"><span>changed</span><span id="rv-totals">+${snapshot.insertions} −${snapshot.deletions}</span></div>
        <nav class="rv-files" id="rv-rail" aria-label="Changed files">${files.map((file, index) => railRow(file, index, comments, reviewed)).join("\n")}</nav>
        <p class="bf-note" id="rv-rail-empty" hidden><span id="rv-rail-empty-text"></span> <button type="button" class="bf-btn bf-btn--sm" id="rv-rail-clear">Clear filter</button></p>
      </div>
    </aside>
  </details>
  <main class="bf-app__main rv-main" id="rv-main" tabindex="-1">
    <div class="rv-files-scroll" id="rv-diff">
      <p class="rv-filter-note" id="rv-filter-note" hidden><span id="rv-filter-note-text"></span> <button type="button" class="bf-btn" id="rv-filter-clear">Clear</button></p>
      ${banner}
      ${omitted}
      ${main}
    </div>
  </main>
</div>
${pageFooter({ facts: `${comparisonLine(snapshot)} · ${all.length} files · +${snapshot.insertions} −${snapshot.deletions} · ${plural(drafts.length, "draft")} · ${done} of ${all.length} reviewed`, factsId: "rv-facts" })}

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

/** The document a scope with no answer serves: the reason, and how to leave it. */
export function renderReviewProblem(base: string, title: string, message: string): string {
	return `<!doctype html>
<html lang="en"${baseAttribute(base)}>
<head>
${docHead({ title: tabTitle("review", title), css: pageSheet(REVIEW_CSS), base })}
</head>
<body class="bf-app">
<h1 class="sr-only">review — ${escapeHtml(title)}</h1>
${appHead({ product: "review", subject: { label: title, title }, facts: "" })}
<main class="bf-app__main" id="rv-main">
  <div class="rv-empty">
    <p class="rv-empty__title">${escapeHtml(title)}</p>
    <p class="rv-empty__sub">${escapeHtml(message)}</p>
    <p class="rv-empty__sub"><a href="${escapeHtml(base)}/new">Back to the review</a></p>
  </div>
</main>
${pageFooter({ facts: "review" })}
</body>
</html>`;
}
