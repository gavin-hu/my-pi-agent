/**
 * The review page's wiring: the controls, the two document handlers, and the keys.
 *
 * A fragment of the same IIFE `client.ts` ships — `REVIEW_KEYS_JS` is interpolated into
 * `REVIEW_CLIENT_JS` after the comments and the place, because a fragment's top-level
 * statements run in the order they are concatenated and the page's start block is last.
 * Nothing here owns state: every handler calls a function one of the two fragments above
 * declares, and the keys only decide which of them a key press means.
 */
export const REVIEW_KEYS_JS = String.raw`  function setWrap(on) {
    byId("rv-wrap").setAttribute("aria-pressed", String(on));
    nodeList(".rv-diff").forEach(function (diff) { diff.setAttribute("data-wrap", String(on)); });
  }

  // The page wraps below the fold whatever the button said, so the button speaks for the diff and
  // not for itself (#814): it starts pressed there, and only the reader's own press crosses over.
  var wrapChosen = false;
  function toggleWrap() {
    wrapChosen = true;
    setWrap(byId("rv-wrap").getAttribute("aria-pressed") !== "true");
  }

  var narrowQuery = window.matchMedia("(max-width: " + data.narrow + "px)");
  function followWidth() {
    if (!wrapChosen) setWrap(narrowQuery.matches);
  }
  if (narrowQuery.addEventListener) narrowQuery.addEventListener("change", followWidth);
  followWidth();

  var reloadHint = byId("reload-hint");
  if (reloadHint) reloadHint.addEventListener("click", function () { window.location.reload(); });

  byId("rv-filter").addEventListener("input", filtered);
  byId("rv-filter").addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    // Inside the field, Escape is the field's: clear both halves and leave the field.
    event.stopPropagation();
    byId("rv-filter").value = "";
    pressView(false);
    filtered();
    byId("rv-filter").blur();
  });
  // The rail's narrowing is one fact with two halves, so one press pair owns both segments.
  function pressView(only) {
    byId("rv-view-all").setAttribute("aria-pressed", String(!only));
    byId("rv-view-commented").setAttribute("aria-pressed", String(only));
  }
  byId("rv-view-all").addEventListener("click", function () { pressView(false); filtered(); });
  byId("rv-view-commented").addEventListener("click", function () { pressView(true); filtered(); });
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
  byId("rv-sel-comment").addEventListener("click", commentOnSelection);
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
        scrollMainTo(node);
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
      // The composer Escape closes is the one the focus is in: with one per line, closing them all
      // would take text the reviewer was not done writing. The textarea itself stops the event, so
      // this branch is the Save and Cancel buttons' own.
      var inComposer = document.activeElement && document.activeElement.closest ? document.activeElement.closest(".rv-compose") : null;
      if (inComposer) { cancelComposer(inComposer); return; }
      var filter = byId("rv-filter");
      if (document.activeElement === filter || filter.value !== "") {
        filter.value = "";
        pressView(false);
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
    if (event.key === "]" || event.key === "n") { moveHunk(1); return; }
    if (event.key === "[" || event.key === "p") { moveHunk(-1); return; }
    if (event.key === "Enter" && cursor && actsOnCursor(event.target)) {
      event.preventDefault();
      commentOnSelection();
      return;
    }
    if (event.key === "c" && cursor) {
      event.preventDefault();
      commentOnSelection();
      return;
    }
    if (event.key === "m") {
      var marked = currentFile || (cursor && cursor.path);
      if (marked) markReviewed(marked, !reviewedSet().has(marked));
    }
  });
`;
