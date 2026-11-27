/**
 * The review page's reveal: where a row lands when the page brings it into view, the scroll the
 * page itself set, and the room the last screenful needs below its last row.
 *
 * A fragment of the same IIFE `client.ts` ships — `REVIEW_REVEAL_JS` is interpolated before the
 * place fragment. It is its own module because one geometry has three readers: placement, the
 * spy that names the file in view, and the tail spacer that gives the last row somewhere to go.
 * The place fragment owns the cursor; this owns the viewport the cursor moves in. `restoring`
 * outranks the spy on the first paints, and `expectedScroll` marks a scroll the page made.
 */
export const REVIEW_REVEAL_JS = String.raw`  // ── the reveal ────────────────────────────────────────────────────────────

  /** How far down the band under the pinned head a placed row sits, as a fraction of it. */
  var READING_LINE = 1 / 3;

  /** The pinned head's height over a section's rows: the head that comes to rest above them. */
  function headHeight(section) {
    var head = section ? section.querySelector(".rv-file__head") : null;
    return head ? head.offsetHeight : 0;
  }

  /** The tallest head at this width: a head may wrap, so the band is measured from the tallest. */
  function headBand() {
    var height = 0;
    sections().forEach(function (section) {
      var measured = headHeight(section);
      if (measured > height) height = measured;
    });
    return height;
  }

  /** Where a row lands in the main's viewport: READING_LINE down the band under its file's head. */
  function readingLine(main, section) {
    var height = headHeight(section);
    return main.getBoundingClientRect().top + height + (main.clientHeight - height) * READING_LINE;
  }

  /**
   * Bring a row onto the reading line. With keep, move only when the row has left the band around
   * that line, and then by the least that returns it: reading down a file must not scroll the page
   * on every line it passes. The row lives inside the diff's own overflow box, so scrollIntoView
   * stops at that box; scrolling the main by the measured delta is the one path that lands where
   * the reader looks.
   */
  function reveal(row, keep) {
    var main = byId("rv-main");
    if (!main || !row) return;
    var section = row.closest(".rv-file");
    var line = readingLine(main, section);
    var top = row.getBoundingClientRect().top;
    var target = line;
    if (keep) {
      var band = main.clientHeight - headHeight(section);
      var low = line - band / 4;
      var high = line + band / 4;
      if (top >= low && top <= high) return;
      target = top < low ? low : high;
    }
    main.scrollTop += top - target;
    // A scroll the page made is not a scroll the reader made: the spy must not repaint the
    // rail from the position a jump just set.
    expectedScroll = main.scrollTop;
  }

  /** The scroll this page just set, so the spy can tell it from the reader's own. */
  var expectedScroll = null;

  /**
   * The room below the last row that lets it reach the reading line: the scroll box cannot be
   * scrolled past its content, so a row in the last screenful needs somewhere to go. The spacer
   * hangs on the content, because a flex child spends its own padding inside its height.
   */
  function fitTail() {
    var main = byId("rv-main");
    var tail = byId("rv-tail");
    if (!main || !tail) return;
    var content = main.scrollHeight - tail.offsetHeight;
    var band = main.clientHeight - headBand();
    tail.style.height = content > main.clientHeight ? Math.max(0, Math.round(band * (1 - READING_LINE))) + "px" : "0px";
  }

  /**
   * The file the reader is in: the last section whose head reached the reading line. One geometry
   * with placement — the line a jump puts a row on is the line that names the file — so a jump
   * into a new file is not read back as the file it left. Two passes, because the line is measured
   * from the head that will be pinned and the pinned head is the one the line names.
   */
  function fileInView(main, list) {
    var inView = list[0] || null;
    for (var pass = 0; pass < 2; pass++) {
      var line = readingLine(main, inView);
      var found = list[0] || null;
      for (var index = 0; index < list.length; index++) {
        var head = list[index].querySelector(".rv-file__head");
        var top = head ? head.getBoundingClientRect().top : list[index].getBoundingClientRect().top;
        if (top <= line) found = list[index];
        else break;
      }
      if (found === inView) return inView;
      inView = found;
    }
    return inView;
  }

  var spyFrame = 0;
  function spy() {
    if (restoring) return;
    var main = byId("rv-main");
    if (!main) return;
    if (expectedScroll !== null) {
      // The first scroll event after the page's own scroll is the page's, not the reader's. It is
      // spent whether or not it was ours: a suppression kept past its scroll would swallow the
      // reader's next one at the same position.
      var ours = Math.abs(main.scrollTop - expectedScroll) < 2;
      expectedScroll = null;
      if (ours) return;
    }
    var inView = fileInView(main, sections());
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

`;
