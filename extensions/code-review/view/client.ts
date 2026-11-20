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
  var selection = { path: null, from: null, to: null, side: "new" };
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
      return kept && kept.rev === rev ? kept : null;
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
    composer(kept.path, kept.line, kept.side, kept.text);
    toast("An unsent comment was restored");
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
    var facts = byId("rv-facts");
    if (facts) {
      var done = reviewedSet().size;
      var files = sections().length;
      facts.textContent = "snapshot " + rev + " · " + plural(files, "file") + " · " + pending + " draft · " + done + " of " + files + " reviewed";
    }
    paintStates();
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
      clearSelection();
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
  function composer(path, line, side, seed) {
    closeComposer();
    var row = rowFor(path, line, side);
    if (!row) { toast("That line is not in the diff any more — reload the page"); return; }
    var wrap = el("span", "rv-compose");
    wrap.setAttribute("data-path", path);
    wrap.setAttribute("data-line", String(line));
    wrap.setAttribute("data-side", side);
    var head = el("span", "rv-compose__head", "comment on " + splitPath(path).name + ":" + line);
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

  // ── selection ─────────────────────────────────────────────────────────────
  function firstLineOf(section) {
    var row = section ? section.querySelector(".bf-diff-line") : null;
    if (!row) return 1;
    var numbers = row.querySelectorAll(".browse-diff-no");
    for (var index = 0; index < numbers.length; index++) {
      var number = Number(numbers[index].textContent.trim());
      if (number) return number;
    }
    return 1;
  }
  function paintSelection() {
    sections().forEach(function (section) {
      var path = section.getAttribute("data-path");
      var lines = section.querySelectorAll(".bf-diff-line");
      for (var index = 0; index < lines.length; index++) {
        var numbers = lines[index].querySelectorAll(".browse-diff-no");
        var wanted = selection.side === "old" ? numbers[0] : numbers[1];
        var number = wanted ? Number(wanted.textContent.trim()) : NaN;
        var on = path === selection.path && number >= selection.from && number <= selection.to;
        lines[index].setAttribute("data-picked", on ? "true" : "false");
      }
      var rail = railFor(path);
      if (rail) rail.setAttribute("aria-current", path === selection.path ? "true" : "false");
    });
    var bar = byId("rv-selbar");
    if (!bar) return;
    if (selection.path === null) { bar.setAttribute("data-open", "false"); return; }
    var span = selection.from === selection.to ? String(selection.from) : selection.from + "–" + selection.to;
    var ref = selection.path + ":" + span;
    byId("rv-selbar-ref").textContent = ref;
    byId("rv-selbar-ref").setAttribute("data-ref", ref);
    bar.setAttribute("data-open", "true");
  }
  function setSelection(path, side, from, to) {
    selection = { path: path, side: side, from: from, to: to };
    paintSelection();
  }
  function clearSelection() {
    selection = { path: null, side: "new", from: null, to: null };
    paintSelection();
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
  function filtered() {
    var text = byId("rv-filter").value.trim().toLowerCase();
    var only = byId("rv-only-commented").checked;
    var shown = 0;
    sections().forEach(function (section) {
      var path = section.getAttribute("data-path");
      var rail = railFor(path);
      var match = text === "" || path.toLowerCase().indexOf(text) >= 0;
      if (only) match = match && commentsFor(path).length > 0;
      section.hidden = !match;
      if (rail) rail.hidden = !match;
      if (match) shown += 1;
    });
    byId("rv-file-count").textContent = shown + " of " + sections().length + " files";
  }

  function moveFile(step) {
    var visible = sections().filter(function (section) { return !section.hidden; });
    if (visible.length === 0) return;
    var current = selection.path === null ? -1 : visible.findIndex(function (section) { return section.getAttribute("data-path") === selection.path; });
    var next = Math.min(visible.length - 1, Math.max(0, (current < 0 ? 0 : current) + step));
    var path = visible[next].getAttribute("data-path");
    var line = firstLineOf(visible[next]);
    setSelection(path, "new", line, line);
    visible[next].scrollIntoView({ block: "start" });
  }

  function moveHunk(step) {
    var heads = nodeList(".bf-diff-line--hunk");
    if (heads.length === 0) return;
    var at = heads.findIndex(function (head) { return head.getBoundingClientRect().top > 120; });
    if (at < 0) at = heads.length;
    var target = heads[Math.min(heads.length - 1, Math.max(0, at + (step > 0 ? 0 : -1)))];
    if (target) target.scrollIntoView({ block: "start" });
  }

  function toggleWrap() {
    var button = byId("rv-wrap");
    var on = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(on));
    nodeList(".rv-diff").forEach(function (diff) { diff.setAttribute("data-wrap", String(on)); });
  }

  byId("rv-filter").addEventListener("input", filtered);
  byId("rv-only-commented").addEventListener("change", filtered);
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
    if (selection.path !== null) composer(selection.path, selection.from, selection.side);
  });
  byId("rv-sel-copy").addEventListener("click", function () {
    var ref = byId("rv-selbar-ref").getAttribute("data-ref");
    var done = function () { toast("Copied " + ref); };
    try { navigator.clipboard.writeText(ref).then(done, done); } catch (error) { toast(ref); }
  });

  document.addEventListener("click", function (event) {
    var gutter = event.target.closest ? event.target.closest(".browse-diff-no") : null;
    if (gutter) {
      var section = gutter.closest(".rv-file");
      var path = section.getAttribute("data-path");
      var numbers = gutter.closest(".bf-diff-line").querySelectorAll(".browse-diff-no");
      var side = numbers[1] === gutter ? "new" : "old";
      var line = Number(gutter.textContent.trim());
      if (event.shiftKey && selection.path === path && selection.from !== null) {
        setSelection(path, side, Math.min(selection.from, line), Math.max(selection.from, line));
      } else if (selection.path === path && selection.from === line && selection.to === line) {
        clearSelection();
      } else {
        setSelection(path, side, line, line);
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
      var railPath = rail.getAttribute("data-path");
      var line = firstLineOf(sectionFor(railPath));
      setSelection(railPath, "new", line, line);
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      if (!byId("rv-send-dialog").hidden) { closeSend(); return; }
      if (document.querySelector(".rv-compose")) { forgetDraft(); closeComposer(); return; }
      clearSelection();
      return;
    }
    if (typing(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "w") { toggleWrap(); return; }
    if (event.key === "j") { moveFile(1); return; }
    if (event.key === "k") { moveFile(-1); return; }
    if (event.key === "]") { moveHunk(1); return; }
    if (event.key === "[") { moveHunk(-1); return; }
    if (event.key === "c" && selection.path !== null) { event.preventDefault(); composer(selection.path, selection.from, selection.side); return; }
    if (event.key === "m" && selection.path !== null) {
      markReviewed(selection.path, !reviewedSet().has(selection.path));
    }
  });

  paintThreads();
  paintChrome();
  restoreDraft();
${THEME_TOGGLE_JS}
${dialogScript({ dialogId: "rv-send-dialog", closeId: "rv-send-close", globalName: "rvSend" })}
${keysDialogScript("keys-open")}
})();`;
