/**
 * The review page's chrome: what the page says about itself.
 *
 * It is a fragment of the same IIFE `web-client.ts` ships (`WEB_CHROME_JS` is
 * interpolated into `REVIEW_CLIENT_JS`), kept in its own module so the state
 * chip, the status line, and the header are read together and away from the
 * document rendering. It paints only text it was handed.
 */

export const WEB_CHROME_JS = String.raw`  function setStatus(text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.title = text || "";
    statusEl.className = kind ? "bf-status bf-status--" + kind : "bf-status";
  }

  // The always-visible header chip: connection, comment count, and whether
  // there are edits the file does not have yet.
  function updateState() {
    if (!stateEl) return;
    var label;
    var tone = "";
    if (approved) {
      label = "Approved";
      tone = "success";
    } else if (saved) {
      label = "Saved";
      tone = "success";
    } else if (closed) {
      // Settled by the user, not by a dropped stream: never flash Offline.
      label = "Closed";
    } else if (connected === true) {
      label = "Connected";
      tone = "success";
    } else if (everConnected) {
      // Only after the stream has opened once: an error before that is a
      // transient initial connect, so keep showing Connecting rather than Offline.
      label = "Offline";
      tone = "danger";
    } else {
      label = "Connecting\u2026";
    }
    var count = annotations.length;
    label += " \u00b7 " + count + (count === 1 ? " comment" : " comments");
    if (dirty && !saved && !approved && !closed) {
      label += " \u00b7 " + (role === "reviewer" ? "unposted" : "unsaved");
      if (!tone) tone = "warn";
    }
    stateEl.textContent = label;
    stateEl.className = "bf-chip bf-chip--accent review-state" + (tone ? " bf-chip--" + tone : "");
  }

  function renderHeader() {
    var titleEl = document.getElementById("plan-title");
    if (titleEl && data.title) {
      titleEl.textContent = data.title;
      titleEl.title = data.title;
    }
    if (data.title) document.title = "Plan review \u00b7 " + data.title;
  }

  function updateProgress() {
    if (!progressEl) return;
    var doc = document.scrollingElement || document.documentElement;
    var top = doc ? doc.scrollTop : 0;
    var height = doc ? doc.scrollHeight : 0;
    var view = doc ? doc.clientHeight : 0;
    if (planEl && planEl.scrollHeight > planEl.clientHeight + 4) {
      top = planEl.scrollTop; height = planEl.scrollHeight; view = planEl.clientHeight;
    }
    var max = height - view;
    var percent = max > 0 ? Math.min(100, Math.max(0, (top / max) * 100)) : 0;
    progressEl.style.width = percent + "%";
  }

  function lockActions() {
    if (approveButton) approveButton.disabled = true;
    if (saveButton) saveButton.disabled = true;
    if (postButton) postButton.disabled = true;
    if (cancelButton) cancelButton.disabled = true;
  }

  // A conflict means the file moved under the page; only a reload can re-anchor.
  function offerReload() {
    if (document.getElementById("reload")) return;
    var controls = document.querySelector(".review-controls");
    if (!controls) return;
    var reload = el("button");
    reload.type = "button";
    reload.id = "reload";
    reload.className = "bf-btn bf-btn--primary";
    reload.textContent = "Reload";
    reload.addEventListener("click", function () { window.location.reload(); });
    controls.appendChild(reload);
  }

  // The stream exists only to notice a closed tab. Once the review is settled it
  // has no job, and leaving it open retries a dead port until the tab closes.
  function settleStream() {
    if (stream && stream.close) { stream.close(); stream = null; }
  }
`;
