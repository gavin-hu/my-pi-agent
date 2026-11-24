/**
 * The review page's place: the cursor, the file in view, the headers' measured height, and
 * the rail's filter.
 *
 * A fragment of the same IIFE `client.ts` ships — `REVIEW_PLACE_JS` is interpolated into
 * `REVIEW_CLIENT_JS`. These are one capability because they share one state: `cursor` and
 * `anchor` say which rows the keys act on, `currentFile` says which file the rail marks and
 * the spy writes, `restoring` keeps the first paints from overwriting the place the URL
 * names, and `expectedScroll` tells a scroll this page made from the reader's own. The
 * filter is here rather than beside the keys that call it because it hides the rail's rows
 * that `visibleFiles` crosses and that `paintRail` marks — split apart, the two halves of
 * "the rail's rows" would answer differently.
 */
export const REVIEW_PLACE_JS = String.raw`  // ── the cursor ────────────────────────────────────────────────────────────
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

  // ── the rail's filter ────────────────────────────────────────────────────
  /** The rail rows the current filter shows, and what the filter is. */
  function visibleState() {
    var text = byId("rv-filter").value.trim().toLowerCase();
    var only = byId("rv-view-commented").getAttribute("aria-pressed") === "true";
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
      data.comparison +
      " · " +
      files +
      " · " +
      plural(drafts().length, "draft") +
      " · " +
      reviewedSet().size +
      " of " +
      total +
      " reviewed";
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
    pressView(false);
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

`;
