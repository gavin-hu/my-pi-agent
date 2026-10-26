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
   * Sharing: the owner mints one link per person, re-reads the set, and revokes a
   * single link without touching the others. The QR is the server's inline SVG,
   * parsed and imported rather than pasted, so the page keeps its one rule: no
   * text ever becomes HTML.
   */
  function setQr(svg) {
    if (!shareQrEl) return;
    while (shareQrEl.firstChild) shareQrEl.removeChild(shareQrEl.firstChild);
    if (!svg) return;
    var parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    var root = parsed && parsed.documentElement;
    if (root && root.nodeName === "svg") shareQrEl.appendChild(document.importNode(root, true));
  }

  /** One row per link: its URL, who holds it, and the two things to do with it. */
  function renderShareLinks(state) {
    if (!shareLinksEl) return;
    while (shareLinksEl.firstChild) shareLinksEl.removeChild(shareLinksEl.firstChild);
    var links = state && state.links ? state.links : [];
    links.forEach(function (link) {
      var row = el("li", "review-share__row");
      var url = el("span", "review-share__url");
      url.textContent = link.url;
      url.title = link.url;
      var who = el("span", link.name ? "review-share__who review-share__who--bound" : "review-share__who");
      who.textContent = link.name ? "@" + link.name : "unnamed";
      var actions = el("span", "review-share__actions");
      actions.appendChild(rowButton("Copy", function () { copyLink(link.url); }));
      actions.appendChild(rowButton("Revoke", function () { revokeLink(link.id); }));
      row.appendChild(url);
      row.appendChild(who);
      row.appendChild(actions);
      shareLinksEl.appendChild(row);
    });
  }

  function rowButton(label, onClick) {
    var button = el("button", "bf-btn");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function copyLink(url) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) return;
    navigator.clipboard.writeText(url).then(function () { setStatus("Link copied."); }, function () {});
  }

  function showShare(state, svg) {
    if (!shareDialogNode) return;
    renderShareLinks(state);
    setQr(svg);
    if (shareStop) shareStop.disabled = !(state && state.sharing);
    if (shareNote) {
      shareNote.textContent = state && state.reason
        ? state.reason
        : "One link per person: each link posts under the name it binds. Only you can approve.";
    }
    if (window.bfShare) window.bfShare.open();
  }

  /** POST one share action, then render whatever set the server answered with. */
  function shareAction(route, body, failText) {
    fetch(route + "?token=" + encodeURIComponent(token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    }).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok) throw new Error(payload && payload.error ? payload.error : "server returned " + response.status);
        if (payload && payload.share) showShare(payload.share, payload.svg);
        return payload;
      });
    }).catch(function (error) { setStatus(failText + error.message, "error"); });
  }

  function shareNow() {
    shareAction("/api/share", null, "Could not share: ");
  }

  function newLink() {
    shareAction("/api/share/link", null, "Could not mint a link: ");
  }

  function revokeLink(id) {
    shareAction("/api/share/revoke", { id: id }, "Could not revoke that link: ");
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
   * A reviewer names herself once. The server binds that name to her link on the
   * first post, and a bound link cannot rename itself, so the page shows the name
   * it posts under and stops offering the dialog.
   */
  function renderName() {
    if (!nameButton) return;
    if (role !== "reviewer") { nameButton.hidden = true; return; }
    nameButton.hidden = false;
    nameButton.textContent = reviewerName ? "Reviewing as " + reviewerName : "Set your name";
    nameButton.disabled = reviewerBound;
  }

  /** Take the name the server bound to this link, and stop offering the dialog. */
  function adoptName(name) {
    var value = String(name || "").trim().slice(0, 40);
    if (!value) return;
    reviewerBound = true;
    if (value === reviewerName) { renderName(); return; }
    reviewerName = value;
    try { window.localStorage.setItem("bf-review-name", reviewerName); } catch (error) {}
    renderName();
    renderAll();
  }

  function askName() {
    if (reviewerBound) { setStatus("This link already posts as @" + reviewerName + "."); return; }
    if (nameInput) nameInput.value = reviewerName;
    if (window.bfName) window.bfName.open();
    if (nameInput) nameInput.focus();
  }

  function saveName() {
    if (reviewerBound) return;
    reviewerName = nameInput ? nameInput.value.trim().slice(0, 40) : "";
    try { window.localStorage.setItem("bf-review-name", reviewerName); } catch (error) {}
    if (window.bfName) window.bfName.close();
    renderName();
    renderAll();
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
      clearDraft();
      settleStream();
      lockActions();
      setStatus("The review is closed.", "info");
      updateState();
      return;
    }
    if (kind === "revoked") {
      if (closed) return;
      closed = true;
      clearDraft();
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
        if (typeof next.author === "string" && next.author) adoptName(next.author);
        // This tab's own unsaved comments belong on top of what just arrived.
        restoreDraft();
        renderAll();
        renderFacts();
        updateState();
        setStatus(kind === "plan" ? "The plan changed on disk; showing the new version." : "Updated with a new comment.");
      })
      .catch(function () {});
  }
`;
