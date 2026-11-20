/**
 * The review page's client: one script, no build step, assembled here from three fragments.
 *
 * The element builder, the typing test, and the JSON POST come from the kit's runtime, and the
 * page's own code is three capabilities spliced into this one IIFE: the comments
 * (`client-comments.ts`), the place (`client-place.ts`), and the wiring and keys
 * (`client-keys.ts`). It is one closure and not a namespace because the three share state —
 * `cursor`, `anchor`, `currentFile`, `restoring`, `expectedScroll` — and a second copy of any
 * of it is what a page split across `window.*` objects always drifts into. The state they
 * share is declared here, below, so no fragment owns a name another reads.
 *
 * The review arrives as the `#rv-data` island, so a comment is written into the document with
 * `textContent` and never as markup. Drafts are this tab's: an unsent composer's text is kept
 * in sessionStorage against the snapshot it was typed on, so a reload restores it and a page
 * that renders a different snapshot drops it rather than move a note onto a line nobody read.
 *
 * The fragments are concatenated in load order — comments, place, keys — because their
 * top-level statements run in that order, and the page's start block is last for the same
 * reason: it is the first thing that reads what the fragments declare.
 */

import {
	CLIENT_BASE_JS,
	CLIENT_RUNTIME_JS,
	dialogScript,
	keysDialogScript,
	THEME_TOGGLE_JS,
} from "../../../lib/web/index.ts";
import { REVIEW_COMMENTS_JS } from "./client-comments.ts";
import { REVIEW_KEYS_JS } from "./client-keys.ts";
import { REVIEW_PLACE_JS } from "./client-place.ts";

export const REVIEW_CLIENT_JS = String.raw`(function () {
  "use strict";
${CLIENT_BASE_JS}
${CLIENT_RUNTIME_JS}

  var base = pageBase();
  var root = document.getElementById("rv-data");
  if (!root) return;
  var data = JSON.parse(root.textContent || "{}");
  var token = data.token || "";
  var rev = data.rev || "";
  // The state the three fragments share. cursor, anchor and currentFile are the place's —
  // which row the keys act on, and which file the rail marks and the spy writes; DRAFT_KEY is
  // the comments'; base, data, token, rev and toastTimer are the page's, read by both.
  var DRAFT_KEY = "rv-review-draft";
  var cursor = null;
  var anchor = null;
  var currentFile = null;
  var toastTimer = 0;

  function byId(id) { return document.getElementById(id); }
  function nodeList(selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); }
  function sections() { return nodeList(".rv-file"); }
  function sectionFor(path) {
    return sections().filter(function (section) { return section.getAttribute("data-path") === path; })[0] || null;
  }
  function railFor(path) {
    var rows = nodeList(".rv-rail");
    return rows.filter(function (row) { return row.getAttribute("data-path") === path; })[0] || null;
  }
  function rowFor(path, line, side) {
    var section = sectionFor(path);
    if (!section) return null;
    var rows = section.querySelectorAll(".bf-diff-line");
    for (var index = 0; index < rows.length; index++) {
      var numbers = rows[index].querySelectorAll(".browse-diff-no");
      var wanted = side === "old" ? numbers[0] : numbers[1];
      if (wanted && wanted.textContent.trim() === String(line)) return rows[index];
    }
    return null;
  }
  function drafts() { return (data.comments || []).filter(function (c) { return c.state === "draft"; }); }
  function reviewedSet() { return new Set(data.reviewed || []); }
  function commentsFor(path) { return (data.comments || []).filter(function (c) { return c.rel === path; }); }
  function stateOf(path) {
    if (reviewedSet().has(path)) return "reviewed";
    return commentsFor(path).length > 0 ? "commented" : "new";
  }
  function stateWord(state) {
    if (state === "reviewed") return "marked reviewed";
    // A file without a comment is not "unread": the page cannot know that.
    return "no comment";
  }
  function splitPath(path) {
    var cut = path.lastIndexOf("/");
    return cut < 0 ? { dir: "", name: path } : { dir: path.slice(0, cut), name: path.slice(cut + 1) };
  }
  function plural(count, noun) { return count + " " + noun + (count === 1 ? "" : "s"); }

  function toast(message) {
    var el = byId("rv-toast");
    if (!el) return;
    el.textContent = message;
    el.setAttribute("data-open", "true");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.setAttribute("data-open", "false"); }, 3200);
  }

${REVIEW_COMMENTS_JS}
${REVIEW_PLACE_JS}
${REVIEW_KEYS_JS}

  // The file the reader is in starts as the one the server marked current.
  var startRail =
    nodeList(".rv-rail").filter(function (row) { return row.getAttribute("aria-current") === "true"; })[0] ||
    nodeList(".rv-rail")[0];
  if (startRail) currentFile = startRail.getAttribute("data-path");
  measureHeads();
  observeHeads();
  paintThreads();
  paintChrome();
  restorePlace();
  var reviewMain = byId("rv-main");
  if (reviewMain) reviewMain.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", measureHeads);
  restoreDraft();
${THEME_TOGGLE_JS}
${dialogScript({ dialogId: "rv-send-dialog", closeId: "rv-send-close", globalName: "rvSend" })}
${keysDialogScript("keys-open")}
})();`;
