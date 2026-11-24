/**
 * The review page's comments: the draft this tab keeps, the thread under the line it names,
 * the four writes, the composer, and the send dialog.
 *
 * A fragment of the same IIFE `client.ts` ships — `REVIEW_COMMENTS_JS` is interpolated into
 * `REVIEW_CLIENT_JS` — kept apart so what a comment *is* (its draft, its quote, its state) is
 * read in one place. It owns the page's comment state and no place: it reads the cursor
 * (`focusCursor`) and the row lookup (`rowFor`) the closure holds, and its repaints ask the
 * place fragment for `filtered` and `measureHeads`. Every fragment is inside the one closure,
 * so a call across them reaches a hoisted declaration rather than an import.
 */
export const REVIEW_COMMENTS_JS = String.raw`  // ── drafts ────────────────────────────────────────────────────────────────
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

  // ── threads ───────────────────────────────────────────────────────────────
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
    var send = byId("rv-send");
    if (send) {
      send.disabled = pending === 0;
      send.setAttribute("data-count", String(pending));
      send.textContent = "Send feedback " + pending;
    }
    // An empty Commented view is the rail's note to explain, not a control to disable: the note
    // says there is nothing to narrow to, and the press that hid the rows is one press back.
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
`;
