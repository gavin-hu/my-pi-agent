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
  // One record per anchor, keyed [path, line, side]: a composer per line is what the page is, so a
  // second one must not overwrite the first, and a reload brings back every draft whose line is
  // still drawn. The record's rev says which diff it was typed on — provenance for the "was
  // a.ts:3" note a moved one carries, never a write's gate: every write sends the page's rev, so
  // a save lands exactly when the line it names is drawn.
  function storedDrafts() {
    try {
      var raw = sessionStorage.getItem(DRAFT_KEY);
      var kept = raw ? JSON.parse(raw) : null;
      return kept && typeof kept === "object" ? kept : {};
    } catch (error) { return {}; }
  }
  function writeDrafts(all) {
    try {
      if (Object.keys(all).length === 0) sessionStorage.removeItem(DRAFT_KEY);
      else sessionStorage.setItem(DRAFT_KEY, JSON.stringify(all));
    } catch (error) { /* a full or blocked store is not a reason to lose the page */ }
  }
  function draftKey(path, line, side) { return JSON.stringify([path, line, side]); }
  function keepDraft(path, line, side, text, parent) {
    var all = storedDrafts();
    var key = draftKey(path, line, side);
    if (text === "") delete all[key];
    else all[key] = { rev: rev, path: path, line: line, side: side, text: text, parent: parent };
    writeDrafts(all);
  }
  function forgetDraft(path, line, side) {
    var all = storedDrafts();
    delete all[draftKey(path, line, side)];
    writeDrafts(all);
  }
  /** Save the text of the composer the keystroke landed in — not of whichever composer is first. */
  function keepTyping(event) {
    var wrap = event && event.target && event.target.closest ? event.target.closest(".rv-compose") : null;
    if (!wrap) return;
    var area = wrap.querySelector(".rv-compose__area");
    keepDraft(
      wrap.getAttribute("data-path"),
      Number(wrap.getAttribute("data-line")),
      wrap.getAttribute("data-side"),
      area ? area.value : "",
      wrap.getAttribute("data-parent") || undefined,
    );
    paintSend();
  }
  /** The composer standing on one anchor, or null: one per line, which is what the page is. */
  function composerAt(path, line, side) {
    return nodeList(".rv-compose").filter(function (wrap) {
      return wrap.getAttribute("data-path") === path && wrap.getAttribute("data-line") === String(line) && wrap.getAttribute("data-side") === side;
    })[0] || null;
  }
  /** One held comment's text, by id: the words the composer answering it quotes. */
  function commentBody(id) {
    var found = (data.comments || []).filter(function (comment) { return comment.id === id; })[0];
    return found ? found.body : "";
  }

  /** A comment's opening words, so a head or a button names which one it is. */
  function excerpt(text) {
    var line = String(text || "").replace(/\s+/g, " ").trim();
    return line.length > 40 ? line.slice(0, 39) + "…" : line;
  }

  function closeComposer(wrap) {
    if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
  }
  /** Throw away one composer and its record; the others are not this one's business. */
  function cancelComposer(wrap) {
    if (!wrap) return;
    forgetDraft(wrap.getAttribute("data-path"), Number(wrap.getAttribute("data-line")), wrap.getAttribute("data-side"));
    closeComposer(wrap);
    paintSend();
  }
  /** Every draft comes back where it can: at its line, on a drawn line with the old one named, or listed. */
  function restoreDrafts() {
    var all = storedDrafts();
    var back = [];
    var moved = [];
    unplaceableDrafts = [];
    Object.keys(all).forEach(function (key) {
      var kept = all[key];
      if (!kept || typeof kept.text !== "string" || kept.text === "") { delete all[key]; return; }
      if (rowFor(kept.path, kept.line, kept.side)) {
        var parent = kept.parent && (data.comments || []).some(function (comment) { return comment.id === kept.parent; })
          ? kept.parent
          : undefined;
        composer(kept.path, kept.line, kept.side, {
          seed: kept.text,
          moved: kept.rev !== rev,
          focus: false,
          parent: parent,
          parentText: parent === undefined ? undefined : commentBody(parent),
        });
        back.push(kept.path + ":" + kept.line);
        return;
      }
      // The line is gone from this render. Its file may still be drawn, and then the text opens on
      // the file's first drawn row saying which line it was typed on: nothing moves silently.
      var rows = numberedRows(sectionFor(kept.path));
      var at = rows.length > 0 ? rowAnchor(rows[0]) : null;
      if (at) {
        composer(kept.path, at.line, at.side, { seed: kept.text, moved: true, was: kept.path + ":" + kept.line, focus: false });
        moved.push(kept.path + ":" + kept.line);
        return;
      }
      // Neither is drawn: it is listed above the diff and stays stored until its reviewer lets it go.
      unplaceableDrafts.push({ key: key, path: kept.path, line: kept.line, side: kept.side, text: kept.text });
    });
    writeDrafts(all);
    var said = [];
    if (back.length > 0) said.push("Unsent " + plural(back.length, "comment") + " restored — " + back.join(", "));
    if (moved.length > 0) said.push(plural(moved.length, "comment") + " moved to a line this diff draws");
    if (said.length > 0) toast(said.join("; "));
    paintOrphans();
    paintSend();
  }

  // ── threads ───────────────────────────────────────────────────────────────
  function threadNode(comment, isReply) {
    var wrap = el("span", "rv-thread");
    wrap.setAttribute("data-thread", comment.id);
    wrap.setAttribute("data-state", comment.state);
    if (isReply) wrap.setAttribute("data-parent", comment.parent);
    var card = el("span", "bf-comment");
    var label = el("span", "bf-comment__label", comment.state === "sent" ? "sent to the session" : "draft");
    card.appendChild(label);
    if (comment.quote) card.appendChild(el("span", "bf-comment__quote", comment.quote));
    card.appendChild(el("span", "bf-comment__body", comment.body));
    var acts = el("span", "bf-comment__row");
    var where = comment.rel + ":" + comment.line;
    // No reply on a reply: the store holds one level, so offering the verb would promise a 400 the
    // reviewer would only meet after typing. A reply's one action is to remove itself.
    if (!isReply) {
      var reply = el("button", "bf-btn bf-btn--ghost", "reply");
      reply.type = "button";
      reply.setAttribute("aria-label", "Reply to the comment on " + where + ' — "' + excerpt(comment.body) + '"');
      reply.addEventListener("click", function () {
        composer(comment.rel, comment.line, comment.side, { parent: comment.id, parentText: comment.body });
      });
      acts.appendChild(reply);
    }
    var drop = el("button", "bf-btn bf-btn--ghost", "delete");
    drop.type = "button";
    drop.setAttribute("aria-label", "Delete the comment on " + where + ' — "' + excerpt(comment.body) + '"');
    drop.addEventListener("click", function () { dropComment(comment.id); });
    acts.appendChild(drop);
    card.appendChild(acts);
    wrap.appendChild(card);
    return wrap;
  }

  /** The comments this render has no row for; the list above the diff is their only home. */
  var unplaceableComments = [];
  /** The unsent drafts whose file this render does not draw: no composer can stand for them. */
  var unplaceableDrafts = [];

  /**
   * One row's threads in the order they are read: its roots as the review stores them, each followed
   * by the replies it answers, in that same order.
   *
   * Never sorted. The review's array is arrival order, so two comments written in the same
   * millisecond keep it, and the case that reads them is determined rather than lucky. A reply whose
   * parent is not in this list — deleted, since the store only accepts a parent it holds — is a root:
   * a comment that lost its parent is still a comment to read and delete, and hiding it would be the
   * orphan shape #837 closed.
   */
  function rowThreads(comments) {
    var known = {};
    comments.forEach(function (comment) { known[comment.id] = true; });
    var out = [];
    comments
      .filter(function (comment) { return comment.parent === undefined || !known[comment.parent]; })
      .forEach(function (root) {
        out.push({ comment: root, reply: false });
        comments.forEach(function (comment) {
          if (comment.parent === root.id) out.push({ comment: comment, reply: true });
        });
      });
    return out;
  }

  function paintThreads() {
    nodeList(".rv-thread").forEach(function (el) { el.remove(); });
    unplaceableComments = [];
    var rows = [];
    (data.comments || []).forEach(function (comment) {
      var row = rowFor(comment.rel, comment.line, comment.side);
      if (!row) {
        // Only a comment on a file this page draws is unplaced: one on a file a focused page hides is
        // out of view by the reader's own request, and the page says so.
        if (sectionFor(comment.rel)) unplaceableComments.push(comment);
        return;
      }
      var held = rows.filter(function (entry) { return entry.row === row; })[0];
      if (!held) {
        held = { row: row, comments: [] };
        rows.push(held);
      }
      held.comments.push(comment);
    });
    rows.forEach(function (held) {
      // After the row's own last thread, so the newest lands at the bottom of the thread it belongs
      // to rather than above everything written before it.
      var after = held.row;
      while (after.nextSibling && after.nextSibling.classList && after.nextSibling.classList.contains("rv-thread")) after = after.nextSibling;
      rowThreads(held.comments).forEach(function (entry) {
        var node = threadNode(entry.comment, entry.reply);
        after.parentNode.insertBefore(node, after.nextSibling);
        after = node;
      });
    });
    paintOrphans();
  }

  /** One line above the diff: a reference, the text, and the one action that removes it. */
  function orphanItem(ref, body, action, aria, press) {
    var item = el("span", "rv-orphans__item");
    item.appendChild(el("span", "rv-orphans__ref", ref));
    item.appendChild(el("span", "rv-orphans__body", body));
    var button = el("button", "bf-btn bf-btn--ghost", action);
    button.type = "button";
    button.setAttribute("aria-label", aria);
    button.addEventListener("click", press);
    item.appendChild(button);
    return item;
  }

  /**
   * The comments and the unsent drafts this render has no line for: the diff moved under the line
   * they named, so neither a thread can be drawn nor a composer stood up. The list is the only
   * place they can be read and let go — a stored comment's delete, a draft's discard — and a draft
   * nobody can remove is what keeps the page from closing.
   */
  function paintOrphans() {
    var box = byId("rv-orphans");
    var list = byId("rv-orphans-list");
    if (!box || !list) return;
    list.replaceChildren();
    var total = unplaceableComments.length + unplaceableDrafts.length;
    box.hidden = total === 0;
    if (total === 0) return;
    var head = byId("rv-orphans-head");
    if (head) {
      head.textContent =
        "Not on a line this page draws — the diff moved since " + (total === 1 ? "it was" : "they were") + " written";
    }
    unplaceableComments.forEach(function (comment) {
      list.appendChild(
        orphanItem(
          comment.rel + ":" + comment.line,
          comment.body,
          "delete",
          "Delete the comment on " + comment.rel + ":" + comment.line,
          function () { dropComment(comment.id); },
        ),
      );
    });
    unplaceableDrafts.forEach(function (draft) {
      list.appendChild(
        orphanItem(
          draft.path + ":" + draft.line + " · unsent",
          draft.text,
          "discard",
          "Discard the unsent comment on " + draft.path + ":" + draft.line,
          function () { discardDraft(draft.key); },
        ),
      );
    });
  }

  /** Let one unplaceable draft go: it is the reviewer's text, so only they can decide that. */
  function discardDraft(key) {
    unplaceableDrafts = unplaceableDrafts.filter(function (draft) { return draft.key !== key; });
    var all = storedDrafts();
    delete all[key];
    writeDrafts(all);
    paintOrphans();
    toast("Unsent comment discarded");
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
        // The count keeps the name's line; the state word is the title's now, because a row that
        // spends a line on its state is a row fewer in a rail that is capped and scrolls (#817).
        var notes = rail.querySelector(".rv-rail__notes");
        var count = commentsFor(path).length;
        if (notes) {
          notes.textContent = count === 0 ? "" : plural(count, "comment");
          notes.hidden = count === 0;
        }
        rail.setAttribute("title", path + " — " + railNote(path));
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

  /** The composers holding text, as what a write would need to save each of them. */
  function typedComposers() {
    return nodeList(".rv-compose").map(function (wrap) {
      var area = wrap.querySelector(".rv-compose__area");
      return {
        wrap: wrap,
        path: wrap.getAttribute("data-path"),
        line: Number(wrap.getAttribute("data-line")),
        side: wrap.getAttribute("data-side"),
        parent: wrap.getAttribute("data-parent") || undefined,
        text: area ? area.value.trim() : "",
      };
    }).filter(function (entry) { return entry.text !== ""; });
  }

  /**
   * What Send will do, in one number: the drafts the session holds and the text still in a composer.
   *
   * The button is a promise, so it counts the typing too — a label that says 3 while the press
   * sends 4 is the defect, not the count. Loose drafts the page cannot draw are excluded on
   * purpose: they are not a composer's, and Send cannot reach them.
   */
  function pendingCount() { return drafts().length + typedComposers().length; }

  function paintSend() {
    var send = byId("rv-send");
    if (!send) return;
    var pending = pendingCount();
    send.disabled = pending === 0;
    send.setAttribute("data-count", String(pending));
    send.textContent = "Send feedback " + pending;
  }

  function paintChrome() {
    paintSend();
    // An empty Commented view is the rail's note to explain, not a control to disable: the note
    // says there is nothing to narrow to, and the press that hid the rows is one press back.
    paintStates();
    paintProgress();
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
        // A refused write changed nothing, so every control goes back to the state the page was
        // rendered with: a checkbox the reviewer just toggled is the one that would otherwise lie.
        paintChrome();
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

  function addComment(path, line, side, text, wrap) {
    var parent = wrap && wrap.getAttribute("data-parent") ? wrap.getAttribute("data-parent") : undefined;
    var comment = { rel: path, line: line, side: side, body: text };
    return post("/api/comment", { comment: parent === undefined ? comment : { ...comment, parent: parent } }, function () {
      forgetDraft(path, line, side);
      closeComposer(wrap);
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
  /**
   * Open the composer standing on one anchor, or return to the one already there.
   *
   * One per line: pressing comment on a line that already has one puts the cursor back in its text
   * rather than starting a second and losing the first. The options are the text to restore, the
   * note a draft typed on an earlier diff carries, the anchor a relocated one came from, and
   * whether to take the cursor — a restored composer does not.
   */
  function composer(path, line, side, opts) {
    opts = opts || {};
    var row = rowFor(path, line, side);
    if (!row) { toast("Select a line that is in the diff, then comment"); return; }
    var open = composerAt(path, line, side);
    if (open) {
      // One composer per line, and the line is what owns its text: pressing reply on a line whose
      // composer is already open answers with that text rather than starting a second — the text is
      // still a draft, so adopting the parent asserts nothing and the press is not ignored.
      var openArea = open.querySelector(".rv-compose__area");
      if (opts.seed !== undefined && openArea) openArea.value = opts.seed;
      if (opts.parent && open.getAttribute("data-parent") !== opts.parent) {
        open.setAttribute("data-parent", opts.parent);
        open.querySelector(".rv-compose__head").textContent =
          "reply on " + splitPath(path).name + ":" + line;
        if (opts.parentText) {
          open.querySelector(".rv-compose__head").appendChild(el("span", "rv-compose__note", "“" + excerpt(opts.parentText) + "”"));
        }
        if (openArea) openArea.setAttribute("aria-label", "Reply on " + path + ":" + line);
      }
      if (openArea) keepDraft(path, line, side, openArea.value, opts.parent || open.getAttribute("data-parent") || undefined);
      if (openArea && opts.focus !== false) openArea.focus();
      return;
    }
    var wrap = el("span", "rv-compose");
    wrap.setAttribute("data-path", path);
    wrap.setAttribute("data-line", String(line));
    wrap.setAttribute("data-side", side);
    if (opts.parent) wrap.setAttribute("data-parent", opts.parent);
    var head = el("span", "rv-compose__head", (opts.parent ? "reply on " : "comment on ") + splitPath(path).name + ":" + line);
    if (opts.parentText) head.appendChild(el("span", "rv-compose__note", "“" + excerpt(opts.parentText) + "”"));
    if (opts.was) head.appendChild(el("span", "rv-compose__note", "was " + opts.was + " — the diff moved"));
    else if (opts.moved) head.appendChild(el("span", "rv-compose__note", "typed on the earlier diff — check the line"));
    var area = el("textarea", "rv-compose__area");
    area.placeholder = "What is wrong, and what would you do instead?";
    area.setAttribute("aria-label", (opts.parent ? "Reply on " : "Comment on ") + path + ":" + line);
    if (opts.seed !== undefined) area.value = opts.seed;
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
    if (opts.focus !== false) area.focus();
    var submit = function () {
      var text = area.value.trim();
      if (!text) { area.focus(); return; }
      if (text.length > data.limits.body) { toast("A comment holds at most " + data.limits.body + " characters"); return; }
      addComment(path, line, side, text, wrap);
    };
    save.addEventListener("click", submit);
    cancel.addEventListener("click", function () { cancelComposer(wrap); });
    area.addEventListener("input", keepTyping);
    area.addEventListener("keydown", function (event) {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); submit(); }
      if (event.key === "Escape") { event.stopPropagation(); cancelComposer(wrap); }
    });
  }

  // ── send ──────────────────────────────────────────────────────────────────
  /**
   * Save every composer holding text, in order, and stop at the first refusal.
   *
   * A flush can stop halfway — one save lands, the next is refused — so what it leaves is the state
   * the page shows: what landed is a draft the session holds, what did not is still in its composer
   * with its record. Its writes carry the page's rev like any save, which is why a draft restored
   * onto a moved tree still lands when its line is drawn.
   */
  function flushComposers() {
    return typedComposers().reduce(function (chain, entry) {
      return chain.then(function (ok) {
        if (!ok) return false;
        return post(
          "/api/comment",
          {
            comment: {
              rel: entry.path,
              line: entry.line,
              side: entry.side,
              ...(entry.parent === undefined ? {} : { parent: entry.parent }),
              body: entry.text,
            },
          },
          function () {
            forgetDraft(entry.path, entry.line, entry.side);
            closeComposer(entry.wrap);
            paintThreads();
            paintSend();
          },
        ).then(function (answer) { return answer.ok; });
      });
    }, Promise.resolve(true));
  }

  function openSend() {
    flushComposers().then(function (ok) {
      // A refused save leaves the dialog shut: its own toast said which line, and the text is
      // where the reviewer left it rather than queued for a send that would not carry it.
      if (!ok) return;
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
    });
  }
  function closeSend() {
    byId("rv-send-dialog").hidden = true;
  }
  function sendNow() {
    post("/api/send", {}, function () {
      closeSend();
      paintThreads();
      paintChrome();
      toast("Comments sent — the session reads them at its next turn");
    });
  }
`;
