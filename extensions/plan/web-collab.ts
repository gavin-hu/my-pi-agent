/**
 * The shared review's client half: who is looking, and what everyone else does.
 *
 * A fragment of the same IIFE `web-client.ts` ships (`WEB_COLLAB_JS` is
 * interpolated into `REVIEW_CLIENT_JS`), kept apart so the reviewer identity, the
 * share dialog, and the stream-driven refetch are read together and away from
 * the document rendering. It owns no state of its own: it reads the page's
 * `data`, `annotations`, `role`, and `reviewerName` and calls the page's own
 * `renderPlan` / `renderFacts` / `updateState` / `setStatus`.
 */

export const WEB_COLLAB_JS = String.raw`  /**
   * Sharing: the owner mints a reviewer link here, and the same dialog revokes
   * it. The QR is the server's inline SVG, parsed and imported rather than
   * pasted, so the page keeps its one rule: no text ever becomes HTML.
   */
  function showShare(state, svg) {
    if (!shareDialogNode) return;
    var link = state && state.links && state.links[0];
    if (shareLinkEl) {
      shareLinkEl.textContent = link ? link.url : (state && state.reason) || "Sharing is unavailable.";
    }
    if (shareQrEl) {
      while (shareQrEl.firstChild) shareQrEl.removeChild(shareQrEl.firstChild);
      if (link && svg) {
        var parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
        var root = parsed && parsed.documentElement;
        if (root && root.nodeName === "svg") shareQrEl.appendChild(document.importNode(root, true));
      }
    }
    if (shareCopy) shareCopy.disabled = !link;
    if (shareStop) shareStop.disabled = !link;
    if (shareNote) {
      shareNote.textContent = link
        ? "Anyone with this link can read the plan and comment. Only you can approve."
        : "";
    }
    if (window.bfShare) window.bfShare.open();
  }

  function shareNow() {
    fetch("/api/share?token=" + encodeURIComponent(token), { method: "POST" })
      .then(function (response) { return response.json(); })
      .then(function (payload) { if (payload && payload.share) showShare(payload.share, payload.svg); })
      .catch(function () { setStatus("Could not share: the server did not answer.", "error"); });
  }

  function stopSharing() {
    fetch("/api/share/stop?token=" + encodeURIComponent(token), { method: "POST" })
      .then(function (response) { return response.json(); })
      .then(function (payload) {
        if (payload && payload.share) showShare(payload.share, null);
        setStatus("Reviewers can no longer open this review.");
      })
      .catch(function () { setStatus("Could not stop sharing.", "error"); });
  }

  /**
   * A reviewer names themselves once. The name is local to this browser and is
   * what their comments are signed with; it is a label, not an account.
   */
  function renderName() {
    if (!nameButton) return;
    if (role !== "reviewer") { nameButton.hidden = true; return; }
    nameButton.hidden = false;
    nameButton.textContent = reviewerName ? "Reviewing as " + reviewerName : "Set your name";
  }

  function askName() {
    if (nameInput) nameInput.value = reviewerName;
    if (window.bfName) window.bfName.open();
    if (nameInput) nameInput.focus();
  }

  function saveName() {
    reviewerName = nameInput ? nameInput.value.trim().slice(0, 40) : "";
    try { window.localStorage.setItem("bf-review-name", reviewerName); } catch (error) {}
    if (window.bfName) window.bfName.close();
    renderName();
    renderPlan();
  }

  /**
   * Another open page changed the review: a comment landed, the plan was saved,
   * or sharing changed. The island is the one contract, so the page re-reads it
   * and re-renders rather than growing a second update path. A draft in progress
   * is never thrown away; the status line says what arrived instead.
   */
  function refreshFromServer(event) {
    var kind = event && event.data ? String(event.data).trim() : "";
    // A terminal frame is the server saying why this page will not update again;
    // a reviewer has no decision to make, so being told beats reading "Offline".
    if (kind === "closed") {
      if (saved || approved || closed) return;
      closed = true;
      settleStream();
      lockActions();
      setStatus("The review is closed.", "info");
      updateState();
      return;
    }
    if (kind === "revoked") {
      if (closed) return;
      closed = true;
      settleStream();
      lockActions();
      setStatus("The owner stopped sharing this review \u2014 your comments stay in the plan.", "info");
      updateState();
      return;
    }
    if (saved || approved || closed) return;
    if (draftTextarea()) {
      setStatus("A change arrived; finish or discard your draft to see it.");
      return;
    }
    fetch(window.location.pathname + window.location.search)
      .then(function (response) { return response.text(); })
      .then(function (html) {
        var parsed = new DOMParser().parseFromString(html, "text/html");
        var node = parsed.getElementById("review-data");
        if (!node || !node.textContent) return;
        var next = JSON.parse(node.textContent);
        data = next;
        annotations = Array.isArray(next.annotations) ? next.annotations.slice() : [];
        renderPlan();
        renderFacts();
        updateState();
        setStatus(kind === "plan" ? "The plan changed on disk; showing the new version." : "Updated with a new comment.");
      })
      .catch(function () {});
  }
`;
