/**
 * The review page's drafts: one record per anchor, the text a composer holds, and what comes back
 * after a reload.
 *
 * A fragment of the same IIFE `client.ts` ships — `REVIEW_DRAFTS_JS` is interpolated before the
 * comments fragment — because what a draft *is* (its span, its record, where it comes back) is one
 * capability, while the thread it becomes is the comments fragment's. It reads the cursor's anchor
 * and the row lookup the closure holds, so a call across fragments reaches a hoisted declaration.
 */
export const REVIEW_DRAFTS_JS = String.raw`  // ── drafts ────────────────────────────────────────────────────────────────
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
  function keepDraft(span) {
    var all = storedDrafts();
    var key = draftKey(span.path, span.line, span.side);
    if (span.text === "") delete all[key];
    else {
      all[key] = {
        rev: rev,
        path: span.path,
        line: span.line,
        side: span.side,
        endLine: span.endLine,
        quote: span.quote,
        parent: span.parent,
        text: span.text,
      };
    }
    writeDrafts(all);
  }

  /**
   * The span a composer stands for: its anchor, the reply it answers, the lines it covers, what it
   * quotes, and the text typed in it. One reader, so the draft record, the flush and the write cannot
   * disagree about what the box names.
   */
  function composerSpan(wrap) {
    var area = wrap.querySelector(".rv-compose__area");
    var endLine = Number(wrap.getAttribute("data-end-line"));
    return {
      path: wrap.getAttribute("data-path"),
      line: Number(wrap.getAttribute("data-line")),
      side: wrap.getAttribute("data-side"),
      endLine: endLine > 0 ? endLine : undefined,
      quote: wrap.getAttribute("data-quote") || undefined,
      parent: wrap.getAttribute("data-parent") || undefined,
      text: area ? area.value : "",
    };
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
    keepDraft(composerSpan(wrap));
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
    // A frame that arrived while the reader was typing was held rather than applied; the box is
    // gone now, so it lands. This is what makes that drop a delay and not a loss.
    liveFlush();
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
          endLine: kept.endLine,
          quote: kept.quote,
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
  }`;
