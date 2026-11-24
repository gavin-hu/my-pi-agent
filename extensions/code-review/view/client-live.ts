/**
 * The review's live frame, as a fragment of the page's one script.
 *
 * `REVIEW_LIVE_JS` is spliced into `REVIEW_CLIENT_JS`, so it is written as statements that run
 * in one closure with the comment and place fragments: it calls their `adopt` and `paintChrome`
 * rather than owning a second copy of what a repaint is.
 *
 * Two limits belong here rather than in a commit message, because a reader of the code meets
 * them as behaviour:
 *
 * - **A frame that lands while a composer is open is held, not applied.** Repainting threads
 *   under a box being typed into would close it, so the state waits in `livePending` and lands
 *   when the box closes — the tab is stale until then, which is the price of not eating the
 *   sentence. Held is not dropped: `closeComposer` calls `liveFlush`, so the frame arrives.
 * - **The page is never reloaded by a frame.** `moved` reveals the header's reload chip, which
 *   is the page's existing way out and keeps every draft; a reload that fires itself under a
 *   reader is how a page loses the place they were reading.
 *
 * The stream's own states — connecting, live, reconnecting, dead — are the kit's, so the chip's
 * words come from `paintLiveState` and this fragment adds nothing to them.
 */

export const REVIEW_LIVE_JS = String.raw`  // Live frames: the review's state from any tab, and the fact that the tree moved.
  var liveChip = byId("rv-live");
  /** A frame that arrived while a composer was open, waiting for the box to close. */
  var livePending = null;
  /** The review ended: the server said so, and the chip keeps that word for good. */
  var liveSettled = false;

  /** One sink for both a frame that could apply and one that had to wait. */
  function liveApply(review) {
    adopt({ body: { review: review } });
    paintChrome();
  }

  /** A composer is open on this page: the reader is typing, and a repaint would close it. */
  function liveTyping() {
    return nodeList(".rv-compose").length > 0;
  }

  /**
   * The box just closed, so whatever arrived while it was open can be applied now.
   *
   * Called by closeComposer, which is why a dropped frame is a delay and never a loss.
   */
  function liveFlush() {
    if (livePending === null) return;
    var review = livePending;
    livePending = null;
    liveApply(review);
  }

  function liveFrame(event) {
    if (event && event.data === "closed") {
      // The review is over, so the stream is ended by the server and the chip stops pretending
      // it will come back. Nothing on the page is stale — it is the last state there was.
      liveSettled = true;
      livePending = null;
      paintLive(liveChip, "muted", "review closed", "This review ended — run /review to open another");
      return;
    }
    var frame = null;
    try { frame = JSON.parse(event && event.data ? event.data : ""); } catch (error) { return; }
    if (!frame) return;
    if (frame.moved) {
      // The tree moved under every tab. The way out is the header's reload, which keeps drafts.
      var hint = byId("reload-hint");
      if (hint) hint.hidden = false;
      return;
    }
    if (frame.review) {
      if (liveTyping()) { livePending = frame.review; return; }
      liveApply(frame.review);
    }
  }

  if (liveChip) {
    liveStream({
      url: base + "/events",
      token: token,
      words: function (state) {
        // A closed review's word is the page's, not a stream state's, so the kit's table does
        // not get to overwrite it once the server has said the review is over.
        if (liveSettled) return;
        paintLiveState(liveChip, state);
      },
      frame: liveFrame
    });
  }

`;
