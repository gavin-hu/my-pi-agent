/**
 * The review page's place: the cursor, the file in view, the headers' measured height, and
 * the rail's filter.
 *
 * A fragment of the same IIFE `client.ts` ships — `REVIEW_PLACE_JS` is interpolated into
 * `REVIEW_CLIENT_JS` after the reveal. These are one capability because they share one state:
 * `cursor` and `anchor` say which rows the keys act on, `currentFile` says which file the rail
 * marks and the spy writes, and `restoring` keeps the first paints from overwriting the place
 * the URL names. Where a row lands is the reveal's; `expectedScroll` and the tail live there,
 * because placement and the spy that names the file measure one line. The filter is here rather
 * than beside the keys that call it because it hides the rail's rows that `visibleFiles`
 * crosses and that `paintRail` marks — split apart, the two halves of "the rail's rows" would
 * answer differently.
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

  /** A diff row's own text: its code, without the two gutters and the sign the renderer puts first. */
  function rowText(row) {
    var parts = [];
    var nodes = row.childNodes;
    for (var index = 3; index < nodes.length; index++) parts.push(nodes[index].textContent || "");
    return parts.join("");
  }

  /**
   * What the selection names, as the span a comment stores — or the sentence saying why it names
   * none. One side only: a rectangle across a removed and an added row names two different anchors,
   * and the page refuses rather than comment on a subset of what the reviewer highlighted.
   *
   * Takes the anchor paintSelection already read, so one paint derives it once; its other caller
   * (commentOnSelection) reads it here.
   */
  function selectionSpan(at) {
    at = at || rowAnchor(cursorRow());
    if (!cursor || !at) return { refusal: "Select a line that is in the diff, then comment" };
    var single = { path: cursor.path, line: at.line, side: at.side };
    if (!anchor || anchor.path !== cursor.path || anchor.row === cursor.row) return { span: single };
    var rows = numberedRows(sectionFor(cursor.path));
    var from = Math.min(anchor.row, cursor.row);
    var to = Math.max(anchor.row, cursor.row);
    var first = rowAnchor(rows[from]);
    var last = rowAnchor(rows[to]);
    if (!first || !last) return { span: single };
    if (first.side !== last.side) return { refusal: "A range stays on one side of the diff — comment on the new side or the old" };
    var text = rows.slice(from, to + 1).map(rowText).join("\n");
    var limit = data.limits.quote;
    return {
      span: {
        path: cursor.path,
        line: first.line,
        endLine: last.line,
        side: first.side,
        quote: text.length > limit ? text.slice(0, limit) : text,
        clipped: text.length > limit,
      },
    };
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

  /**
   * Mark the gutter span the bar's ref names, so the number in the bar is the number on the row.
   *
   * A surviving row carries two numbers and anchors to the new one, so a click on the old column
   * would otherwise show a ref matching no number under the pointer. The other column then says what
   * it is and what a press on it names; the mark and those titles move with every pick.
   */
  var anchorNumber = null;
  var anchorRow = null;
  function markAnchor(row, at) {
    if (anchorNumber) anchorNumber.removeAttribute("data-anchor");
    if (anchorRow) {
      var was = anchorRow.querySelectorAll(".browse-diff-no");
      for (var index = 0; index < was.length; index++) was[index].removeAttribute("title");
    }
    anchorNumber = null;
    anchorRow = null;
    if (!row || !at) return;
    var numbers = row.querySelectorAll(".browse-diff-no");
    var wanted = numbers[at.side === "old" ? 0 : 1];
    if (!wanted || wanted.textContent.trim() === "") return;
    wanted.setAttribute("data-anchor", "true");
    anchorNumber = wanted;
    anchorRow = row;
    var other = numbers[at.side === "old" ? 1 : 0];
    var otherNumber = other ? other.textContent.trim() : "";
    // Only where the two numberings differ: on a hunk that moves nothing the old number says nothing.
    if (otherNumber !== "" && otherNumber !== String(at.line)) {
      other.title = "old line " + otherNumber + " — this line survives, so the comment names new line " + at.line;
    }
  }

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

  /**
   * How far the bar reaches up from a box's bottom edge, plus the gap it wants above itself.
   * Measured rather than fixed, because the bar's height follows its ref: 45px at 1440 wide and
   * 61 at 600. A closed bar reaches nowhere, and 0 is how a caller knows there is nothing to
   * reserve.
   */
  function barClearance(edgeBottom) {
    var bar = byId("rv-selbar");
    if (!bar || bar.getAttribute("data-open") !== "true") return 0;
    return Math.max(0, edgeBottom - bar.getBoundingClientRect().top) + 8;
  }

  /**
   * Reserve the bar's height under the diff while the bar is open, so the file's last rows can be
   * scrolled above it instead of being read through it. The pair the pinned head already uses: the
   * measurement here, the rule in the sheet, and one property joining the two.
   */
  function fitBarInset() {
    var main = byId("rv-main");
    if (!main) return;
    var clearance = barClearance(main.getBoundingClientRect().bottom);
    if (clearance > 0) main.style.setProperty("--rv-bar-inset", clearance + "px");
    else main.style.removeProperty("--rv-bar-inset");
  }

  /** Both measurements follow the viewport: the heads' height, how far the bar reaches, and the tail. */
  function remeasure() {
    measureHeads();
    fitBarInset();
    fitTail();
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
    reveal(cursorRow());
    scrollRailTo(currentFile);
    writePlace();
  }

  /** Paint the cursor (and its range), the rail's current file, and the bar's ref. */
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
      markAnchor(null, null);
      bar.setAttribute("data-open", "false");
      fitBarInset();
      return;
    }
    markAnchor(row, at);
    var picked = selectionSpan(at);
    // A selection that names no span — two sides of a removed-and-added pair — shows the cursor's own line, and
    // the title says why the range is not one: the press that comments refuses with the same words.
    var ref = picked.span
      ? pathRef(picked.span.path, picked.span.line, picked.span.endLine, picked.span.side === "old" ? "old" : undefined)
      : pathRef(cursor.path, at.line, undefined, at.side === "old" ? "old" : undefined);
    byId("rv-selbar-ref").title = picked.refusal || "";
    byId("rv-selbar-ref").textContent = ref;
    byId("rv-selbar-ref").setAttribute("data-ref", ref);
    bar.setAttribute("data-open", "true");
    // After the open: the bar's box is what the inset is measured from, and a closed bar has none.
    fitBarInset();
    if (focus) {
      // The row is the focus target: tabindex="-1" keeps it out of the tab order, and the
      // focus ring tells a keyboard reader which line the next key acts on.
      row.setAttribute("tabindex", "-1");
      try { row.focus({ preventScroll: true }); } catch (error) { row.focus(); }
    }
  }

  /** Put the cursor on one row, clearing or keeping the range anchor; place on the reading line. */
  function placeCursor(path, row, extend, place) {
    if (!extend) anchor = null;
    else if (!anchor && cursor && cursor.path === path) anchor = { path: path, row: cursor.row };
    cursor = { path: path, row: row };
    currentFile = path;
    followCursor(path, place);
  }

  /**
   * Paint what the cursor now means and write the place.
   *
   * One tail for every cursor change: a caller that moves the cursor and paints it by hand — the
   * shift-click in the keys module — would otherwise skip the hash, and a reload would land on
   * the line the reader had before the click. A hunk jump places the row on the reading line; a
   * key move or a click keeps it where it is while it stays inside its band.
   */
  function followCursor(path, place) {
    paintSelection(true);
    reveal(cursorRow(), !place);
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

  /**
   * How far the review has got, in the rail's head — the one place the page prints it, and the
   * reason the footer no longer does. Marking a file reaches this through paintChrome, which is
   * where the page repaints state; the filter does not, because it changes what is shown while this
   * counts the whole review.
   */
  function paintProgress() {
    var progress = byId("rv-progress");
    if (!progress) return;
    progress.textContent = reviewedSet().size + " of " + data.files + " reviewed";
  }

  /**
   * Narrowing is the rail's business: the rows hide, the diff keeps every section, and the
   * rail and the pane both say what the narrower index leaves out.
   */
  function filtered() {
    var state = visibleState();
    // The count speaks for the scope, the note for the rail: a focused page draws one row of a
    // two-file scope, and both numbers are then true of something the reader can see.
    byId("rv-file-count").textContent = state.shown + " of " + data.files + " files";
    var empty = byId("rv-rail-empty");
    if (empty) {
      var none = (data.comments || []).length === 0;
      // A focused page draws one file of a larger scope, so the rail can be empty for a reason no filter
      // explains: the comments exist, on files this page does not draw. Say that, and name the control that
      // shows this file again, instead of blaming a filter the reader never typed.
      var focused = state.total < data.files;
      var message =
        state.shown > 0 || state.total === 0
          ? ""
          : state.text !== ""
            ? 'No files match "' + state.text + '"'
            : state.only && none
              ? "No comments on this review yet"
              : state.only && focused
                ? "No comments in this file — clear Commented to see it"
                : "";
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
  }

  /** Clear both halves of the filter, then put the cursor back where it was typed. */
  function clearFilter() {
    byId("rv-filter").value = "";
    pressView(false);
    filtered();
    byId("rv-filter").focus();
  }

  /** The visible files' hunk heads, in the order the page draws them — the same universe a move crosses. */
  function hunks() {
    var out = [];
    visibleFiles().forEach(function (path) {
      var section = sectionFor(path);
      if (!section) return;
      var heads = section.querySelectorAll(".bf-diff-line--hunk");
      for (var index = 0; index < heads.length; index++) out.push(heads[index]);
    });
    return out;
  }

  /** The row a hunk lands on: its first changed line, else its first numbered row. */
  function hunkRow(head) {
    var first = null;
    var node = head.nextElementSibling;
    while (node && !(node.classList && node.classList.contains("bf-diff-line--hunk"))) {
      if (node.classList && node.classList.contains("bf-diff-line") && rowAnchor(node)) {
        if (!first) first = node;
        if (node.classList.contains("bf-diff-line--add") || node.classList.contains("bf-diff-line--del")) return node;
      }
      node = node.nextElementSibling;
    }
    return first;
  }

  /**
   * The hunk the place is in: the cursor's when there is one, else the last hunk above the reading
   * line. A remembered place is what makes the next press monotonic — a jump the viewport cannot
   * complete would otherwise re-pick the same hunk forever.
   */
  function hunkIndex(heads) {
    var row = cursorRow();
    var index;
    if (row) {
      var at = -1;
      for (index = 0; index < heads.length; index++) {
        if (heads[index].compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING) at = index;
        else break;
      }
      return at;
    }
    var main = byId("rv-main");
    var section = sectionFor(currentFile) || sections()[0] || null;
    if (!main || !section) return heads.length - 1;
    var line = readingLine(main, section);
    var above = -1;
    for (index = 0; index < heads.length; index++) {
      if (heads[index].getBoundingClientRect().top <= line) above = index;
      else break;
    }
    return above;
  }

  /**
   * Step to the next or previous hunk and move the place with it: the cursor lands on the hunk's
   * first changed row, so the hash, a reload and the rail all follow the jump and Enter comments on
   * the change the reader just reached. Within one file when the caller asks for it; a press past
   * either end says so rather than leaving a dead key.
   */
  function moveHunk(step, inFile) {
    var heads = hunks();
    if (heads.length === 0) return;
    var path = (cursor && cursor.path) || currentFile;
    if (inFile) {
      var section = sectionFor(path);
      heads = heads.filter(function (head) { return head.closest(".rv-file") === section; });
      if (heads.length === 0) {
        toast("No changes in " + splitPath(path).name);
        return;
      }
    }
    var target = hunkIndex(heads) + step;
    if (target < 0 || target >= heads.length) {
      toast(inFile ? "No more changes in " + splitPath(path).name : "No more changes");
      return;
    }
    var row = hunkRow(heads[target]);
    if (!row) return;
    var home = row.closest(".rv-file");
    var index = numberedRows(home).indexOf(row);
    if (index < 0) return;
    placeCursor(home.getAttribute("data-path"), index, false, true);
  }

`;
