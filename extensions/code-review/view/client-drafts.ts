/**
 * The review page's drafts: one record per draft, the text a composer holds, and what comes back
 * after a reload.
 *
 * A record is keyed by an id the page mints, because the anchor is a *field*: a line moves when the
 * diff does, and a draft named by where it was cannot be deleted by the composer it became.
 *
 * A fragment of the same IIFE `client.ts` ships — `REVIEW_DRAFTS_JS` is interpolated before the
 * comments fragment — because what a draft *is* (its span, its record, where it comes back) is one
 * capability, while the thread it becomes is the comments fragment's. It reads the cursor's anchor
 * and the row lookup the closure holds, so a call across fragments reaches a hoisted declaration.
 */
export const REVIEW_DRAFTS_JS = String.raw`  // ── drafts ────────────────────────────────────────────────────────────────
  // One record per draft, keyed by an id this page mints: a composer per line is what the page is,
  // so a second one must not overwrite the first, and a reload brings back every draft whose line is
  // still drawn. The anchor, the reply it answers and the lines it covers are fields — a moved draft
  // carries them to its new place rather than being named by where it used to be. The record's rev
  // says which diff it was typed on — provenance for the "was a.ts:3" note a moved one carries, never
  // a write's gate: every write sends the page's rev, so a save lands exactly when the line it names
  // is drawn.
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
  /**
   * A draft's identity, unique against the store it is written into rather than against the clock.
   *
   * The clock and the random suffix make a collision unlikely; the loop against the store makes it
   * impossible for the drafts this page is holding, which is the whole set a reload can confuse — a
   * collision brings one reviewer's text back under another draft's name.
   */
  function newDraftId(all) {
    var minted = 0;
    var id;
    do {
      minted += 1;
      id = "d" + Date.now().toString(36) + "-" + minted.toString(36) + "-" + Math.random().toString(36).slice(2, 7);
    } while (all && all[id]);
    return id;
  }
  function keepDraft(span) {
    var all = storedDrafts();
    var id = span.id || newDraftId(all);
    if (span.text === "") delete all[id];
    else {
      all[id] = {
        id: id,
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
      id: wrap.getAttribute("data-draft-id"),
      path: wrap.getAttribute("data-path"),
      line: Number(wrap.getAttribute("data-line")),
      side: wrap.getAttribute("data-side"),
      endLine: endLine > 0 ? endLine : undefined,
      quote: wrap.getAttribute("data-quote") || undefined,
      parent: wrap.getAttribute("data-parent") || undefined,
      text: area ? area.value : "",
    };
  }
  function forgetDraft(id) {
    var all = storedDrafts();
    delete all[id];
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
    forgetDraft(wrap.getAttribute("data-draft-id"));
    closeComposer(wrap);
    paintSend();
  }
  /**
   * Every record onto the id it is deleted by, once, on first load.
   *
   * A record written before drafts had identities is keyed by its anchor. Migrating it is what makes
   * this change safe for a reviewer who is mid-review: their text comes back where it was standing,
   * and from then on it is deletable by the composer it became.
   */
  function migrateDrafts(all) {
    Object.keys(all).forEach(function (key) {
      var kept = all[key];
      if (!kept || typeof kept !== "object") { delete all[key]; return; }
      if (kept.id === key) return;
      var id = kept.id && all[kept.id] === undefined ? kept.id : newDraftId(all);
      kept.id = id;
      delete all[key];
      all[id] = kept;
    });
  }

  /** Every draft comes back where it can: at its line, on a drawn line with the old one named, or listed. */
  function restoreDrafts() {
    var all = storedDrafts();
    migrateDrafts(all);
    var back = [];
    var moved = [];
    unplaceableDrafts = [];
    Object.keys(all).forEach(function (id) {
      var kept = all[id];
      if (!kept || typeof kept.text !== "string" || kept.text === "") { delete all[id]; return; }
      var drawn = rowFor(kept.path, kept.line, kept.side);
      var rows = drawn ? [] : numberedRows(sectionFor(kept.path));
      // Where this record would land: its own line, or — when that line is gone from this render — its
      // file's first drawn row, which is where a relocated draft opens so nothing moves silently.
      var at = drawn ? { line: kept.line, side: kept.side } : rows.length > 0 ? rowAnchor(rows[0]) : null;
      // Two records can want one line, and the box already there is the identity: it holds the text its
      // reader is typing in, so this record goes rather than surviving beside it as a second record for
      // one composer — which is a save that forgets the wrong one and a draft that comes back.
      if (at !== null && composerAt(kept.path, at.line, at.side)) { delete all[id]; return; }
      if (drawn) {
        var parent = kept.parent && (data.comments || []).some(function (comment) { return comment.id === kept.parent; })
          ? kept.parent
          : undefined;
        composer(kept.path, kept.line, kept.side, {
          id: id,
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
      if (at !== null) {
        var was = kept.path + ":" + kept.line;
        // The record moves with the composer: the anchor is a field now, so the next load starts where
        // the draft lives instead of trying a line this diff no longer draws.
        kept.line = at.line;
        kept.side = at.side;
        composer(kept.path, at.line, at.side, { id: id, seed: kept.text, moved: true, was: was, focus: false });
        moved.push(was);
        return;
      }
      // Neither is drawn: it is listed above the diff and stays stored until its reviewer lets it go.
      unplaceableDrafts.push({ id: id, path: kept.path, line: kept.line, side: kept.side, text: kept.text });
    });
    writeDrafts(all);
    var said = [];
    if (back.length > 0) said.push("Unsent " + plural(back.length, "comment") + " restored — " + back.join(", "));
    if (moved.length > 0) said.push(plural(moved.length, "comment") + " moved to a line this diff draws");
    if (said.length > 0) toast(said.join("; "));
    paintOrphans();
    paintSend();
  }`;
