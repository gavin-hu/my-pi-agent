/**
 * The review page's client: one script, no build step.
 *
 * The element builder, the typing test, and the JSON POST come from the kit's
 * runtime; everything here is this page's own — a thread under the line it names,
 * a composer, the selection, the send dialog, the marks, and the keys. The review
 * arrives as the `#rv-data` island, so a comment is written into the document with
 * `textContent` and never as markup.
 *
 * Drafts are this tab's: an unsent composer's text is kept in sessionStorage
 * against the snapshot it was typed on, so a reload restores it and a page that
 * renders a different snapshot drops it rather than move a note onto a line
 * nobody read.
 */

import {
	CLIENT_BASE_JS,
	CLIENT_RUNTIME_JS,
	dialogScript,
	keysDialogScript,
	THEME_TOGGLE_JS,
} from "../../../lib/web/index.ts";

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
  function drafts() { return (data.comments || []).filter(function (c) { return c.state === "draft"; }); }
  function reviewedSet() { return new Set(data.reviewed || []); }
  function commentsFor(path) { return (data.comments || []).filter(function (c) { return c.rel === path; }); }
  function stateOf(path) {
    if (reviewedSet().has(path)) return "reviewed";
    return commentsFor(path).length > 0 ? "commented" : "new";
  }
  function stateWord(state) {
    if (state === "reviewed") return "marked reviewed";
    if (state === "commented") return "comments owed";
    return "not read yet";
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

  // ── drafts ────────────────────────────────────────────────────────────────
  function saveDraft(state) {
    try {
      if (state === null) sessionStorage.removeItem(DRAFT_KEY);
      else sessionStorage.setItem(DRAFT_KEY, JSON.stringify(state));
    } catch (error) { /* a full or blocked store is not a reason to lose the page */ }
  }
  function readDraft() {
    try {
      var raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      var kept = JSON.parse(raw);
      // The record's rev is where it was typed, not a reason to drop it: a moved diff is the
      // case this draft exists for, and the composer says where it came from.
      return kept && typeof kept.text === "string" && kept.text !== "" ? kept : null;
    } catch (error) { return null; }
  }
  function keepTyping() {
    var area = document.querySelector(".rv-compose__area");
    var head = document.querySelector(".rv-compose");
    saveDraft(area && head ? { rev: rev, path: head.getAttribute("data-path"), line: Number(head.getAttribute("data-line")), side: head.getAttribute("data-side"), text: area.value } : null);
  }
  function forgetDraft() { saveDraft(null); }
  function closeComposer() {
    nodeList(".rv-compose").forEach(function (el) { el.remove(); });
  }
  function restoreDraft() {
    var kept = readDraft();
    if (!kept || !kept.text) return;
    var moved = kept.rev !== rev;
    var path = kept.path;
    var line = kept.line;
    var side = kept.side;
    if (!rowFor(path, line, side)) {
      // The line (or the file) is not in this rendering. Keep the text in a composer that can
      // still save: the first numbered row of its file, or of the first visible file.
      var start = firstRowOf(path);
      if (!start) { saveDraft(kept); toast("An unsent comment is kept, but this diff has no line to put it on"); return; }
      var anchorAt = rowAnchor(start.rows[start.row]);
      if (!anchorAt) { saveDraft(kept); toast("An unsent comment is kept, but this diff has no line to put it on"); return; }
      path = start.path;
      line = anchorAt.line;
      side = anchorAt.side;
    }
    composer(path, line, side, kept.text, moved);
    toast(moved ? "An unsent comment was kept from the earlier diff — check the line" : "An unsent comment was restored");
  }

  // ── rows and threads ──────────────────────────────────────────────────────
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

  function threadNode(comment) {
    var wrap = el("span", "rv-thread");
    wrap.setAttribute("data-thread", comment.id);
    wrap.setAttribute("data-state", comment.state);
    var card = el("span", "bf-comment");
    var label = el("span", "bf-comment__label", comment.state === "sent" ? "sent to the session" : "draft");
    card.appendChild(label);
    if (comment.quote) card.appendChild(el("span", "bf-comment__quote", comment.quote));
    card.appendChild(el("span", "bf-comment__body", comment.body));
    var acts = el("span", "bf-comment__row");
    var reply = el("button", "bf-btn bf-btn--ghost", "reply");
    reply.type = "button";
    reply.addEventListener("click", function () { composer(comment.rel, comment.line, comment.side); });
    var drop = el("button", "bf-btn bf-btn--ghost", "delete");
    drop.type = "button";
    drop.addEventListener("click", function () { dropComment(comment.id); });
    acts.appendChild(reply);
    acts.appendChild(drop);
    card.appendChild(acts);
    wrap.appendChild(card);
    return wrap;
  }

  function paintThreads() {
    nodeList(".rv-thread").forEach(function (el) { el.remove(); });
    (data.comments || []).forEach(function (comment) {
      var row = rowFor(comment.rel, comment.line, comment.side);
      if (!row) return;
      row.parentNode.insertBefore(threadNode(comment), row.nextSibling);
    });
  }

  // ── chrome ────────────────────────────────────────────────────────────────
  function paintStates() {
    sections().forEach(function (section) {
      var path = section.getAttribute("data-path");
      var state = stateOf(path);
      section.setAttribute("data-state", state);
      var rail = railFor(path);
      if (rail) {
        rail.setAttribute("data-state", state);
        var notes = rail.querySelector(".rv-rail__notes");
        var count = commentsFor(path).length;
        if (notes) notes.textContent = count === 0 ? stateWord(state) : plural(count, "comment");
        var mark = rail.querySelector(".rv-rail__mark");
        if (mark) mark.setAttribute("data-state", state);
      }
      var tag = section.querySelector("[data-count]");
      if (tag) {
        var comments = commentsFor(path).length;
        tag.textContent = comments === 0 ? stateWord(state) : plural(comments, "comment");
      }
      var box = section.querySelector("[data-reviewed]");
      if (box) box.checked = reviewedSet().has(path);
    });
  }

  function paintChrome() {
    var pending = drafts().length;
    var state = byId("rv-state");
    if (state) {
      state.textContent = pending === 0 ? "no draft" : plural(pending, "draft");
      state.className = "bf-tag bf-tone--" + (pending === 0 ? "dim" : "warn");
    }
    var idChip = byId("rv-id");
    if (idChip) idChip.textContent = data.id ? "review " + data.id : "no review yet";
    var send = byId("rv-send");
    if (send) {
      send.disabled = pending === 0;
      send.setAttribute("data-count", String(pending));
      send.textContent = "Send feedback " + pending;
    }
    // Nothing to filter to: say so on the control rather than letting it blank the rail.
    var only = byId("rv-only-commented");
    if (only) {
      var none = (data.comments || []).length === 0;
      only.disabled = none;
      var label = only.closest ? only.closest("label") : null;
      if (label) label.title = none ? "No comments on this review yet" : "";
      if (none) only.checked = false;
    }
    paintStates();
    filtered();
    measureHeads();
  }

  // ── writes ────────────────────────────────────────────────────────────────
  function adopt(answer) {
    if (answer.body && answer.body.review) {
      data.comments = answer.body.review.comments;
      data.reviewed = answer.body.review.reviewed;
    }
    if (answer.body && answer.body.id && !data.id) {
      data.id = answer.body.id;
      try {
        var url = new URL(window.location.href);
        url.pathname = base + "/" + data.id;
        url.searchParams.set("token", token);
        window.history.replaceState(null, "", url.toString());
      } catch (error) { /* a replaced URL is a convenience, not the page */ }
    }
  }

  function post(path, payload, done) {
    payload.token = token;
    payload.rev = rev;
    return postJson(base + path, payload).then(function (answer) {
      if (answer.ok) {
        adopt(answer);
        if (done) done();
      } else {
        var message = answer.body && (answer.body.message || answer.body.error) ? answer.body.message || answer.body.error : "the write was refused";
        toast(message);
        if (answer.status === 409) {
          // The tree moved under this page: the kit's reload chip is the way out, and the
          // draft survives the reload.
          var hint = byId("reload-hint");
          if (hint) hint.hidden = false;
        }
      }
      return answer;
    }, function () {
      toast("the page could not reach the session's server");
      return { ok: false, status: 0, body: null };
    });
  }

  function addComment(path, line, side, text) {
    return post("/api/comment", { comment: { rel: path, line: line, side: side, body: text } }, function () {
      forgetDraft();
      closeComposer();
      focusCursor();
      paintThreads();
      paintChrome();
      toast("Comment saved — a draft until you send it");
    });
  }

  function dropComment(id) {
    post("/api/drop", { id: id }, function () {
      paintThreads();
      paintChrome();
      toast("Comment deleted");
    });
  }

  function markReviewed(path, reviewed) {
    post("/api/reviewed", { rel: path, reviewed: reviewed }, function () {
      paintChrome();
      toast((reviewed ? "Marked reviewed — " : "Back to commented — ") + path);
    });
  }

  // ── composer ──────────────────────────────────────────────────────────────
  function composer(path, line, side, seed, moved) {
    closeComposer();
    var row = rowFor(path, line, side);
    if (!row) { toast("Select a line that is in the diff, then comment"); return; }
    var wrap = el("span", "rv-compose");
    wrap.setAttribute("data-path", path);
    wrap.setAttribute("data-line", String(line));
    wrap.setAttribute("data-side", side);
    var head = el("span", "rv-compose__head", "comment on " + splitPath(path).name + ":" + line);
    if (moved) head.appendChild(el("span", "rv-compose__note", "typed on the earlier diff — check the line"));
    var area = el("textarea", "rv-compose__area");
    area.placeholder = "What is wrong, and what would you do instead?";
    area.setAttribute("aria-label", "Comment on " + path + ":" + line);
    if (seed) area.value = seed;
    var acts = el("span", "rv-compose__acts");
    var save = el("button", "bf-btn bf-btn--primary", "Save comment");
    save.type = "button";
    var cancel = el("button", "bf-btn bf-btn--ghost", "Cancel");
    cancel.type = "button";
    var hint = el("span", "bf-dialog__hint", "Ctrl+Enter saves");
    acts.appendChild(save);
    acts.appendChild(cancel);
    acts.appendChild(hint);
    wrap.appendChild(head);
    wrap.appendChild(area);
    wrap.appendChild(acts);
    row.parentNode.insertBefore(wrap, row.nextSibling);
    area.focus();
    var submit = function () {
      var text = area.value.trim();
      if (!text) { area.focus(); return; }
      if (text.length > data.limits.body) { toast("A comment holds at most " + data.limits.body + " characters"); return; }
      addComment(path, line, side, text);
    };
    save.addEventListener("click", submit);
    cancel.addEventListener("click", function () { forgetDraft(); closeComposer(); });
    area.addEventListener("input", keepTyping);
    area.addEventListener("keydown", function (event) {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); submit(); }
      if (event.key === "Escape") { event.stopPropagation(); forgetDraft(); closeComposer(); }
    });
  }

  // ── the cursor ────────────────────────────────────────────────────────────
  // A cursor is a row, not a guessed number: 'row' indexes the numbered rows of its file, so
  // it cannot name a line the diff does not show. The rail's visible rows are the universe a
  // move crosses (#759), and a rail click moves the file without selecting a line.

  /** One row's anchor: the new line when it has one, else the old, so a deletion is reachable. */
  function rowAnchor(row) {
    if (!row) return null;
    var numbers = row.querySelectorAll(".browse-diff-no");
    var newNo = numbers[1] ? Number(numbers[1].textContent.trim()) : NaN;
    if (newNo) return { side: "new", line: newNo };
    var oldNo = numbers[0] ? Number(numbers[0].textContent.trim()) : NaN;
    if (oldNo) return { side: "old", line: oldNo };
    return null;
  }

  /** The rows of a file a cursor can stand on: those that carry a line number on a side. */
  function numberedRows(section) {
    var rows = section ? section.querySelectorAll(".bf-diff-line") : [];
    var out = [];
    for (var index = 0; index < rows.length; index++) {
      if (rowAnchor(rows[index])) out.push(rows[index]);
    }
    return out;
  }

  /** The rail's visible files, in the order the rail lists them. */
  function visibleFiles() {
    return nodeList(".rv-rail")
      .filter(function (row) { return !row.hidden; })
      .map(function (row) { return row.getAttribute("data-path"); });
  }

  function cursorRow() {
    if (!cursor) return null;
    var rows = numberedRows(sectionFor(cursor.path));
    return rows[cursor.row] || null;
  }
  function cursorAnchor() {
    return rowAnchor(cursorRow());
  }

  /** The first numbered row of a file, or of the first visible file that has one. */
  function firstRowOf(path) {
    var section = sectionFor(path);
    var rows = numberedRows(section);
    if (section && rows.length) return { path: section.getAttribute("data-path"), row: 0, rows: rows };
    var files = visibleFiles();
    for (var index = 0; index < files.length; index++) {
      var candidate = sectionFor(files[index]);
      var found = numberedRows(candidate);
      if (found.length) return { path: files[index], row: 0, rows: found };
    }
    return null;
  }

  /** Paint the cursor (and its range), the rail's current file, and the bar's ref. */
  /**
   * Bring a row into the main's viewport, just below the pinned head. The row lives inside the
   * diff's own overflow box, so scrollIntoView stops at that box; scrolling the main by the
   * measured delta is the one path that lands where the reader looks.
   */
  function scrollMainTo(row) {
    var main = byId("rv-main");
    if (!main || !row) return;
    var section = row.closest(".rv-file");
    var head = section ? section.querySelector(".rv-file__head") : null;
    var offset = head ? head.offsetHeight : 0;
    var delta = row.getBoundingClientRect().top - (main.getBoundingClientRect().top + offset);
    main.scrollTop += delta;
    // A scroll the page made is not a scroll the reader made: the spy must not repaint the
    // rail from the position a jump just set.
    expectedScroll = main.scrollTop;
  }

  /** The scroll this page just set, so the spy can tell it from the reader's own. */
  var expectedScroll = null;

  /** The rail's own scroll follows the place: a key move brings its row into the rail's box. */
  function scrollRailTo(path) {
    var row = railFor(path);
    var box = document.querySelector(".rv-side-scroll");
    if (!row || !box) return;
    var rect = row.getBoundingClientRect();
    var bounds = box.getBoundingClientRect();
    if (rect.top < bounds.top) box.scrollTop += rect.top - bounds.top;
    else if (rect.bottom > bounds.bottom) box.scrollTop += rect.bottom - bounds.bottom;
  }

  /** The rail's current mark, from the file in view; the cursor never moves from here. */
  function paintRail() {
    nodeList(".rv-rail").forEach(function (row) {
      row.setAttribute("aria-current", row.getAttribute("data-path") === currentFile ? "true" : "false");
    });
  }

  /** Each head's measured height, so a hunk jump lands below the pinned head at any width. */
  function measureHeads() {
    sections().forEach(function (section) {
      var head = section.querySelector(".rv-file__head");
      var height = head && head.offsetHeight;
      if (height) section.style.setProperty("--rv-head-h", height + "px");
    });
  }

  var headObserver = null;
  function observeHeads() {
    if (typeof ResizeObserver === "undefined") return;
    if (headObserver) headObserver.disconnect();
    headObserver = new ResizeObserver(function () { measureHeads(); });
    sections().forEach(function (section) {
      var head = section.querySelector(".rv-file__head");
      if (head) headObserver.observe(head);
    });
  }

  /**
   * The place as state: the hash names the file and, when there is one, the cursor's line.
   * Replace rather than push, so a key move does not leave one history entry per line.
   */
  function writePlace() {
    var hash = "";
    if (cursor) {
      var at = cursorAnchor();
      var section = sectionFor(cursor.path);
      var index = section ? sections().indexOf(section) : -1;
      if (at && index >= 0) hash = "#rv-file-" + index + ":" + at.line;
    } else if (currentFile) {
      var fileSection = sectionFor(currentFile);
      var fileIndex = fileSection ? sections().indexOf(fileSection) : -1;
      if (fileIndex >= 0) hash = "#rv-file-" + fileIndex;
    }
    if (!hash || location.hash === hash) return;
    try { history.replaceState(null, "", hash); } catch (error) { location.hash = hash; }
  }

  // A restore outranks the spy: the first paints must not overwrite the place the URL names.
  var restoring = true;

  /**
   * Restore the place a reload or a re-render left in the URL. Only where it still exists: a
   * line that is gone falls back to its file's first numbered row, and a file the render no
   * longer holds falls back to the first rendered section.
   */
  function restorePlace() {
    var match = /^#rv-file-(\d+)(?::(\d+))?$/.exec(location.hash || "");
    var index = match ? Number(match[1]) : -1;
    var line = match && match[2] ? Number(match[2]) : null;
    var all = sections();
    var section = index >= 0 && index < all.length ? all[index] : null;
    if (!section) {
      // A render that dropped the hashed file falls back to the first section rather than
      // leaving a hash that names nothing.
      if (all.length) currentFile = all[0].getAttribute("data-path");
      restoring = false;
      paintSelection(false);
      writePlace();
      return;
    }
    var path = section.getAttribute("data-path");
    currentFile = path;
    cursor = null;
    anchor = null;
    if (line) {
      var row = rowFor(path, line, "new") || rowFor(path, line, "old");
      if (row) {
        var at = numberedRows(section).indexOf(row);
        if (at >= 0) cursor = { path: path, row: at };
      }
      if (!cursor) {
        var rows = numberedRows(section);
        if (rows.length) cursor = { path: path, row: 0 };
      }
    }
    restoring = false;
    paintSelection(Boolean(cursor));
    scrollMainTo(cursorRow());
    scrollRailTo(currentFile);
    writePlace();
  }

  // The reading line is the scrollport's own top: the last section whose head reached it is
  // the file the reader is in.
  var spyFrame = 0;
  function spy() {
    if (restoring) return;
    var main = byId("rv-main");
    if (!main) return;
    if (expectedScroll !== null && Math.abs(main.scrollTop - expectedScroll) < 2) return;
    expectedScroll = null;
    var line = main.getBoundingClientRect().top + 1;
    var list = sections();
    var inView = list[0] || null;
    for (var index = 0; index < list.length; index++) {
      var head = list[index].querySelector(".rv-file__head");
      var top = head ? head.getBoundingClientRect().top : list[index].getBoundingClientRect().top;
      if (top <= line) inView = list[index];
      else break;
    }
    if (!inView) return;
    var path = inView.getAttribute("data-path");
    if (path !== currentFile) {
      currentFile = path;
      paintRail();
    }
  }
  function onScroll() {
    if (spyFrame) return;
    spyFrame = requestAnimationFrame(function () { spyFrame = 0; spy(); });
  }

  function paintSelection(focus) {
    sections().forEach(function (section) {
      var path = section.getAttribute("data-path");
      var rows = numberedRows(section);
      var from = -1;
      var to = -1;
      if (cursor && cursor.path === path) {
        from = cursor.row;
        to = cursor.row;
        if (anchor && anchor.path === path) {
          from = Math.min(anchor.row, cursor.row);
          to = Math.max(anchor.row, cursor.row);
        }
      }
      for (var index = 0; index < rows.length; index++) {
        rows[index].setAttribute("data-picked", index >= from && index <= to ? "true" : "false");
      }
    });
    paintRail();
    var bar = byId("rv-selbar");
    if (!bar) return;
    var row = cursorRow();
    var at = rowAnchor(row);
    if (!cursor || !at) {
      bar.setAttribute("data-open", "false");
      return;
    }
    var span = String(at.line);
    if (anchor && anchor.path === cursor.path && anchor.row !== cursor.row) {
      var rangeRows = numberedRows(sectionFor(cursor.path));
      var first = rowAnchor(rangeRows[Math.min(anchor.row, cursor.row)]);
      var last = rowAnchor(rangeRows[Math.max(anchor.row, cursor.row)]);
      if (first && last) span = first.line + "-" + last.line;
    }
    var ref = cursor.path + ":" + span;
    byId("rv-selbar-ref").textContent = ref;
    byId("rv-selbar-ref").setAttribute("data-ref", ref);
    bar.setAttribute("data-open", "true");
    if (focus) {
      // The row is the focus target: tabindex="-1" keeps it out of the tab order, and the
      // focus ring tells a keyboard reader which line the next key acts on.
      row.setAttribute("tabindex", "-1");
      try { row.focus({ preventScroll: true }); } catch (error) { row.focus(); }
    }
  }

  /** Put the cursor on one row, clearing or keeping the range anchor. */
  function placeCursor(path, row, extend) {
    if (!extend) anchor = null;
    else if (!anchor && cursor && cursor.path === path) anchor = { path: path, row: cursor.row };
    cursor = { path: path, row: row };
    currentFile = path;
    paintSelection(true);
    scrollMainTo(cursorRow());
    scrollRailTo(path);
    writePlace();
  }

  /** Move one numbered row, crossing into the next or previous visible file at an end. */
  function moveCursor(step, extend) {
    var files = visibleFiles();
    if (!files.length) return;
    if (!cursor) {
      var preferred = currentFile && files.indexOf(currentFile) >= 0 ? currentFile : files[0];
      var start = firstRowOf(preferred);
      if (start) placeCursor(start.path, step > 0 ? 0 : start.rows.length - 1, false);
      return;
    }
    var rows = numberedRows(sectionFor(cursor.path));
    if (extend) {
      var extended = Math.max(0, Math.min(rows.length - 1, cursor.row + step));
      anchor = anchor && anchor.path === cursor.path ? anchor : { path: cursor.path, row: cursor.row };
      placeCursor(cursor.path, extended, true);
      return;
    }
    var next = cursor.row + step;
    if (next >= 0 && next < rows.length) {
      placeCursor(cursor.path, next, false);
      return;
    }
    var at = files.indexOf(cursor.path);
    if (at < 0) at = step > 0 ? -1 : files.length;
    for (var index = at + (step > 0 ? 1 : -1); index >= 0 && index < files.length; index += step > 0 ? 1 : -1) {
      var target = numberedRows(sectionFor(files[index]));
      if (target.length) {
        placeCursor(files[index], step > 0 ? 0 : target.length - 1, false);
        return;
      }
    }
  }

  function clearSelection() {
    cursor = null;
    anchor = null;
    paintSelection(false);
    writePlace();
  }

  /** A save closes the composer; the cursor is where the reviewer was, so focus goes back to it. */
  function focusCursor() {
    if (cursorRow()) paintSelection(true);
  }

  // ── send ──────────────────────────────────────────────────────────────────
  function openSend() {
    var pending = drafts();
    if (pending.length === 0) return;
    byId("rv-send-title").textContent = "Send " + plural(pending.length, "comment") + " to the session";
    var list = byId("rv-send-list");
    list.replaceChildren();
    pending.forEach(function (comment) {
      var item = el("div", "rv-dialog-item");
      item.appendChild(el("p", "rv-dialog-path", comment.rel + ":" + comment.line));
      item.appendChild(el("p", "rv-dialog-line", comment.body));
      list.appendChild(item);
    });
    byId("rv-send-dialog").hidden = false;
    if (window.rvSend) window.rvSend.open();
    byId("rv-send-confirm").focus();
  }
  function closeSend() {
    byId("rv-send-dialog").hidden = true;
  }
  function sendNow() {
    post("/api/send", {}, function () {
      closeSend();
      paintThreads();
      paintChrome();
      forgetDraft();
      toast("Comments sent — the session reads them at its next turn");
    });
  }

  // ── keys and wiring ───────────────────────────────────────────────────────
  // ── the rail's filter ────────────────────────────────────────────────────
  /** The rail rows the current filter shows, and what the filter is. */
  function visibleState() {
    var text = byId("rv-filter").value.trim().toLowerCase();
    var only = byId("rv-only-commented").checked;
    var shown = 0;
    nodeList(".rv-rail").forEach(function (row) {
      var path = row.getAttribute("data-path");
      var match = text === "" || path.toLowerCase().indexOf(text) >= 0;
      if (only) match = match && commentsFor(path).length > 0;
      row.hidden = !match;
      if (match) shown += 1;
    });
    return { text: text, only: only, shown: shown, total: nodeList(".rv-rail").length };
  }

  /** The file fact the footer prints, which follows the rail while a filter is on. */
  function paintFacts() {
    var facts = byId("rv-facts");
    if (!facts) return;
    var total = sections().length;
    var shown = visibleState().shown;
    var files = shown === total ? plural(total, "file") : shown + " of " + total + " files";
    facts.textContent =
      "snapshot " + rev + " · " + files + " · " + drafts().length + " draft · " + reviewedSet().size + " of " + total + " reviewed";
  }

  /**
   * Narrowing is the rail's business: the rows hide, the diff keeps every section, and the
   * rail and the pane both say what the narrower index leaves out.
   */
  function filtered() {
    var state = visibleState();
    byId("rv-file-count").textContent = state.shown + " of " + state.total + " files";
    var empty = byId("rv-rail-empty");
    if (empty) {
      var none = (data.comments || []).length === 0;
      var message =
        state.shown > 0 || state.total === 0
          ? ""
          : state.only && none
            ? "No comments on this review yet"
            : 'No files match "' + state.text + '"';
      empty.hidden = message === "";
      byId("rv-rail-empty-text").textContent = message;
    }
    var note = byId("rv-filter-note");
    if (note) {
      var active = state.text !== "" || state.only;
      note.hidden = !active;
      byId("rv-filter-note-text").textContent =
        "Showing " +
        state.shown +
        " of " +
        state.total +
        " files" +
        (state.text !== "" ? ' · filter "' + state.text + '"' : "") +
        (state.only ? " · only commented" : "");
    }
    paintFacts();
  }

  /** Clear both halves of the filter, then put the cursor back where it was typed. */
  function clearFilter() {
    byId("rv-filter").value = "";
    byId("rv-only-commented").checked = false;
    filtered();
    byId("rv-filter").focus();
  }

  function moveHunk(step) {
    var heads = nodeList(".bf-diff-line--hunk");
    if (heads.length === 0) return;
    var at = heads.findIndex(function (head) { return head.getBoundingClientRect().top > 120; });
    if (at < 0) at = heads.length;
    var target = heads[Math.min(heads.length - 1, Math.max(0, at + (step > 0 ? 0 : -1)))];
    scrollMainTo(target);
  }

  function toggleWrap() {
    var button = byId("rv-wrap");
    var on = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(on));
    nodeList(".rv-diff").forEach(function (diff) { diff.setAttribute("data-wrap", String(on)); });
  }

  var reloadHint = byId("reload-hint");
  if (reloadHint) reloadHint.addEventListener("click", function () { window.location.reload(); });

  byId("rv-filter").addEventListener("input", filtered);
  byId("rv-filter").addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    // Inside the field, Escape is the field's: clear both halves and leave the field.
    event.stopPropagation();
    byId("rv-filter").value = "";
    byId("rv-only-commented").checked = false;
    filtered();
    byId("rv-filter").blur();
  });
  byId("rv-only-commented").addEventListener("change", filtered);
  byId("rv-rail-clear").addEventListener("click", clearFilter);
  byId("rv-filter-clear").addEventListener("click", clearFilter);
  byId("rv-wrap").addEventListener("click", toggleWrap);
  byId("rv-copy").addEventListener("click", function () {
    var text = (data.comments || []).map(function (comment) { return comment.rel + ":" + comment.line + "\n" + comment.body; }).join("\n\n");
    var done = function () { toast(text ? "Copied every comment as Markdown" : "No comments yet"); };
    try { navigator.clipboard.writeText(text || "no comments yet").then(done, done); } catch (error) { toast("The clipboard is blocked here"); }
  });
  byId("rv-send").addEventListener("click", openSend);
  byId("rv-send-close").addEventListener("click", closeSend);
  byId("rv-send-cancel").addEventListener("click", closeSend);
  byId("rv-send-confirm").addEventListener("click", sendNow);
  byId("rv-sel-clear").addEventListener("click", clearSelection);
  byId("rv-sel-comment").addEventListener("click", function () {
    var at = cursorAnchor();
    if (cursor && at) composer(cursor.path, at.line, at.side);
  });
  byId("rv-sel-copy").addEventListener("click", function () {
    var ref = byId("rv-selbar-ref").getAttribute("data-ref");
    var done = function () { toast("Copied " + ref); };
    try { navigator.clipboard.writeText(ref).then(done, done); } catch (error) { toast(ref); }
  });

  document.addEventListener("click", function (event) {
    var gutter = event.target.closest ? event.target.closest(".browse-diff-no") : null;
    if (gutter) {
      // A click on a gutter is a selection: the row it belongs to becomes the cursor.
      var section = gutter.closest(".rv-file");
      var path = section.getAttribute("data-path");
      var row = gutter.closest(".bf-diff-line");
      var index = numberedRows(section).indexOf(row);
      if (index < 0) return;
      if (event.shiftKey && cursor && cursor.path === path) {
        anchor = anchor && anchor.path === path ? anchor : { path: path, row: cursor.row };
        cursor = { path: path, row: index };
        currentFile = path;
        paintSelection(true);
        var node = cursorRow();
        if (node && node.scrollIntoView) node.scrollIntoView({ block: "nearest" });
      } else {
        placeCursor(path, index, false);
      }
      return;
    }
    var reviewed = event.target.closest ? event.target.closest("[data-reviewed]") : null;
    if (reviewed) {
      markReviewed(reviewed.getAttribute("data-reviewed"), reviewed.checked);
      return;
    }
    var rail = event.target.closest ? event.target.closest(".rv-rail") : null;
    if (rail) {
      // The rail navigates: it says which file the reader is in and drops the line cursor, so
      // no bar opens and no line is invented. The anchor's own jump does the scrolling.
      currentFile = rail.getAttribute("data-path");
      cursor = null;
      anchor = null;
      paintSelection(false);
      writePlace();
    }
  });

  /** Enter acts on the cursor only when the page or a diff row has focus, never on a control. */
  function actsOnCursor(target) {
    if (!target || target === document.body) return true;
    if (target.id === "rv-main") return true;
    return !!(target.classList && target.classList.contains("bf-diff-line"));
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      if (!byId("rv-send-dialog").hidden) { closeSend(); return; }
      if (document.querySelector(".rv-compose")) { forgetDraft(); closeComposer(); return; }
      var filter = byId("rv-filter");
      if (document.activeElement === filter || filter.value !== "") {
        filter.value = "";
        filtered();
        filter.blur();
        return;
      }
      clearSelection();
      return;
    }
    if (typing(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "/") { event.preventDefault(); byId("rv-filter").focus(); return; }
    if (event.key === "w") { toggleWrap(); return; }
    if (event.key === "j" || event.key === "ArrowDown") { event.preventDefault(); moveCursor(1, event.shiftKey); return; }
    if (event.key === "k" || event.key === "ArrowUp") { event.preventDefault(); moveCursor(-1, event.shiftKey); return; }
    if (event.key === "]") { moveHunk(1); return; }
    if (event.key === "[") { moveHunk(-1); return; }
    if (event.key === "Enter" && cursor && actsOnCursor(event.target)) {
      event.preventDefault();
      var atEnter = cursorAnchor();
      if (atEnter) composer(cursor.path, atEnter.line, atEnter.side);
      return;
    }
    if (event.key === "c" && cursor) {
      event.preventDefault();
      var atKey = cursorAnchor();
      if (atKey) composer(cursor.path, atKey.line, atKey.side);
      return;
    }
    if (event.key === "m") {
      var marked = currentFile || (cursor && cursor.path);
      if (marked) markReviewed(marked, !reviewedSet().has(marked));
    }
  });

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
