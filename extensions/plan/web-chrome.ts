/**
 * The review page's chrome: what the page says about itself.
 *
 * It is a fragment of the same IIFE `web-client.ts` ships (`WEB_CHROME_JS` is
 * interpolated into `REVIEW_CLIENT_JS`), kept in its own module so the state
 * chip, the status line, and the reload control are read together and away from
 * the document rendering. It paints only text it was handed: the pill's shape and
 * tone are the kit's (`paintLive`), and what a state *says* is this page's own.
 */

export const WEB_CHROME_JS = String.raw`  // Set once the page has been told it is stale — by a conflict, or by a stream that has
  // gone — so a later frame cannot hide the one control that still helps.
  var needsReload = false;

  // The state the shared stream client last reported. The states themselves are its, so this
  // page cannot disagree with the board about what a dropped stream is; the words are here.
  var liveState = "connecting";

  function setStatus(text, kind) {
    if (statusEl) paintStatus(statusEl, text, kind);
    // The header is where a reader looks for the state, not a place to announce every repaint
    // (lib/web/README.md): the sentence a screen reader hears is its own quiet node, so the line
    // can stay a line that changes colour without interrupting the reader on every frame.
    if (announceEl) announceEl.textContent = text;
  }

  // Reloading is the one action a stale page has: nothing here is unsaved, so it is a
  // control rather than a confirm dialog, and it is the kit's chip rather than a button
  // this page assembles at runtime.
  function offerReload() {
    needsReload = true;
    if (reloadEl) reloadEl.hidden = false;
  }

  // The always-visible header chip: connection, comment count, and whether there are edits
  // the file does not have yet. The three settled words are this page's; the stream's four words
  // and their tones are the kit's table, so a reader sees the same ones on every served page.
  function updateState() {
    if (!stateEl) return;
    var count = annotations.length;
    var suffix = " \u00b7 " + count + (count === 1 ? " comment" : " comments");
    if (dirty && !saved && !approved && !closed) {
      suffix += " \u00b7 " + (role === "reviewer" ? "unposted" : "unsaved");
    }
    // A settled review says so whatever the connection is doing: settling ends the stream, and
    // none of these three is a stream state.
    var settled = approved || saved || closed;
    if (approved) paintLive(stateEl, "success", "approved" + suffix);
    else if (saved) paintLive(stateEl, "success", "saved" + suffix);
    else if (closed) paintLive(stateEl, "", "closed" + suffix);
    else paintLiveState(stateEl, liveState, suffix);
    // A stream that has gone is where this page stops being true, so it offers the reload
    // beside the state that says so. A conflict, which said the same thing about the file,
    // keeps offering it too.
    if (!settled && liveState === "dead") offerReload();
    else if (reloadEl && !needsReload) reloadEl.hidden = true;
  }

  function lockActions() {
    if (approveButton) approveButton.disabled = true;
    if (saveButton) saveButton.disabled = true;
    if (postButton) postButton.disabled = true;
    if (cancelButton) cancelButton.disabled = true;
    // The rail's comment controls go with them: a settled review takes no new comment, and
    // the frame renderer is the one rule that decides that, so this asks for a repaint
    // rather than removing the buttons itself.
    renderAll();
  }

  // The stream exists only to notice a closed tab. Once the review is settled it
  // has no job, and leaving it open retries a dead port until the tab closes.
  function settleStream() {
    if (stream && stream.close) { stream.close(); stream = null; }
  }
`;
