/**
 * The browser review client, served as `/client.js`.
 *
 * Served as one script with no build step, assembled from typed fragments: the element
 * builder, typing test, status paint, and JSON POST come from `lib/web/client-runtime.ts`,
 * and the Markdown, chrome, comments, and collaboration halves are `web-*.ts` modules
 * interpolated below. It renders
 * the plan from the JSON data island using DOM text nodes only — plan and
 * comment text never becomes markup — renders each block
 * with its comment threads indented directly beneath it, highlights code by
 * copying only `tok-*` spans through `DOMParser`, builds the section outline
 * and review facts, and saves the annotation list back to the server. An
 * `EventSource` keeps a connection open so the server can tell when the tab is
 * gone; the explicit buttons are the primary save/cancel path.
 */

import { CLIENT_RUNTIME_JS, dialogScript, keysDialogScript, THEME_TOGGLE_JS } from "../../lib/web/index.ts";
import { WEB_CHROME_JS } from "./web-chrome.ts";
import { WEB_COMMENTS_JS } from "./web-comments.ts";
import { WEB_COLLAB_JS } from "./web-collab.ts";
import { WEB_MARKDOWN_JS } from "./web-markdown.ts";
import { WEB_BLOCKS_JS } from "./web-blocks.ts";
import { WEB_COMPOSER_JS } from "./web-composer.ts";
import { WEB_DRAFT_JS } from "./web-draft.ts";
import { WEB_OUTLINE_JS } from "./web-outline.ts";
import { WEB_PLAN_JS } from "./web-plan.ts";
import { WEB_SETTLE_JS } from "./web-settle.ts";

export const REVIEW_CLIENT_JS = String.raw`(function () {
  "use strict";

  var dataNode = document.getElementById("review-data");
  // The caps come from the island, which takes them from the server's own
  // validation; the fallback only guards a page whose island failed to parse.
  var fallback = { blocks: [], annotations: [], outline: [], steps: { done: 0, total: 0 }, code: {}, limits: { comments: 200, comment: 2000, quote: 500 }, token: "" };
  var data = fallback;
  if (dataNode && dataNode.textContent) {
    try { data = JSON.parse(dataNode.textContent); } catch (error) { data = fallback; }
  }
  var token = typeof data.token === "string" ? data.token : "";
  var limits = data.limits || fallback.limits;
  // Who the server says is looking: the owner approves, a reviewer comments.
  var role = data.role === "reviewer" ? "reviewer" : "owner";
  var reviewerName = typeof data.author === "string" ? data.author : "";
  if (!reviewerName) {
    try { reviewerName = window.localStorage.getItem("bf-review-name") || ""; } catch (error) { reviewerName = ""; }
  }
  // Set once the server has bound a name to this link, which makes it final.
  var reviewerBound = typeof data.author === "string" && !!data.author;
  var DRAFT_REFUSAL = "Add or discard the comment you are writing.";
  // What a body-less conflict says. A 409 the server explained is reported in its
  // own words: a plan that moved and a link bound to another name both land here.
  var PLAN_MOVED = "The plan changed on disk \u2014 reload to review again.";
  var annotations = Array.isArray(data.annotations) ? data.annotations.slice() : [];
  var saved = false;
  var approved = false;
  var closed = false;
  var connected = null;
  var everConnected = false;
  var dirty = false;
  var sectionObserver = null;
  var pendingQuote = null;
  var activeIndex = -1;
  var outlineItems = {};
  /** The island's blocks, or none: one place the client reads them for navigation. */
  function blocks() {
    return Array.isArray(data.blocks) ? data.blocks : [];
  }

  /** The island's outline, or none: the one place the client reads it for the outline. */
  function outlineEntries() {
    return Array.isArray(data.outline) ? data.outline : [];
  }
  var stream = null;

  var planEl = document.getElementById("plan");
  var statusEl = document.getElementById("status");
  var stateEl = document.getElementById("review-state");
  var approveButton = document.getElementById("approve");
  var saveButton = document.getElementById("save");
  var postButton = document.getElementById("post");
  var cancelButton = document.getElementById("cancel");
  var outlineList = document.getElementById("outline-list");
  var progressEl = document.getElementById("progress-fill");

${CLIENT_RUNTIME_JS}

${WEB_OUTLINE_JS}

${WEB_BLOCKS_JS}

${WEB_SETTLE_JS}

${WEB_PLAN_JS}

${WEB_COMPOSER_JS}

${WEB_DRAFT_JS}

${WEB_CHROME_JS}

${WEB_COMMENTS_JS}

${WEB_COLLAB_JS}

${WEB_MARKDOWN_JS}

  // Review facts: the plan's step progress, and the comments per section.
  function facts() {
    // The server counts the same step list approval seeds, so this never disagrees with
    // the todo list over a checkbox outside the Steps section.
    renderFacts(data.steps || { done: 0, total: 0 }, annotations, outlineItems, outlineEntries());
    updateState();
  }

  /**
   * What the composer lifecycle reads, built where its state is.
   *
   * The bundle holds the state and the element handles; web-composer.ts holds the rules,
   * so each call hands it the things those rules ask for and nothing more.
   */
  function composer() {
    return {
      planEl: planEl,
      statusEl: statusEl,
      refusal: DRAFT_REFUSAL,
      setStatus: setStatus,
      saveDraft: saveDraft,
      open: openComposer,
    };
  }

  /**
   * Close the composer, for the surfaces that never see the bundle.
   *
   * The comment fragments call this while they build the form; they own the DOM, not the
   * four pieces the rule reads, so they name the action and this supplies the state.
   */
  function closeOpenComposer() {
    closeComposer(composer());
  }
  /**
   * What a repaint reads and changes, built where the state is.
   *
   * Reads are getters and mutations are callbacks, so the bundle keeps every variable it
   * owns and web-plan.ts holds only the shape of one frame.
   */
  function planFrame() {
    return {
      planEl: planEl,
      outlineList: outlineList,
      focused: document.activeElement,
      blocks: blocks,
      annotations: function () { return annotations; },
      activeIndex: function () { return activeIndex; },
      setActiveIndex: function (index) { activeIndex = index; },
      pendingQuote: function () { return pendingQuote; },
      clearPendingQuote: function () { pendingQuote = null; },
      composer: composer,
      renderBlock: renderBlockContent,
      renderComments: renderComments,
      renderCommentCards: renderCommentCards,
      selectionIn: selectionIn,
      open: openComposer,
      facts: facts,
      updateState: updateState,
    };
  }

  function renderAll() {
    sectionObserver = renderPlanFrame(planFrame(), closeOpenComposer, observeSections, sectionObserver);
  }

  // Save, approve, and post share the same POST shape; what differs is whether
  // the review settles. Only the owner's save and approve resolve the session,
  // so only their callback marks the page terminal. A reviewer posts only their
  // own comments, so a page showing everyone's cannot re-post another writer's.
  // A composer holds text the page has not committed, so the ways off the page
  // refuse while it does: leaving would drop what the reviewer typed.
  /** The ways off the page refuse while a comment is half-written; this says so once. */
  function confirmNoDraft() {
    return guardDraft(planEl, statusEl, DRAFT_REFUSAL, paintStatus);
  }

  /**
   * What the settlement reads and changes, built where the state is.
   *
   * The flags live here, the buttons live here, the stream lives here; web-settle.ts owns
   * the rules about them and reports each change through these callbacks.
   */
  function settlement() {
    return {
      token: function () { return token; },
      role: function () { return role; },
      mine: function () { return annotations.filter(isMine); },
      annotations: function () { return annotations; },
      settled: function () { return saved || approved || closed; },
      setStatus: setStatus,
      buttons: function () { return { approve: approveButton, save: saveButton, post: postButton }; },
      clearDraft: clearDraft,
      markClean: function () { dirty = false; },
      adoptName: adoptName,
      offerReload: offerReload,
      markSettled: function (kind) {
        if (kind === "saved") saved = true;
        else if (kind === "approved") approved = true;
        else closed = true;
      },
      settleStream: settleStream,
      lockActions: lockActions,
      updateState: updateState,
      confirmNoDraft: confirmNoDraft,
      post: postJson,
      send: function (url) { return fetch(url, { method: "POST" }); },
      planMoved: PLAN_MOVED,
    };
  }

  function save() {
    saveReview(settlement());
  }

  function postComments() {
    postReviewComments(settlement());
  }

  function approve() {
    approveReview(settlement());
  }

  function cancel() {
    cancelReview(settlement());
  }

  if (postButton) postButton.addEventListener("click", postComments);
  if (saveButton) saveButton.addEventListener("click", save);
  if (cancelButton) cancelButton.addEventListener("click", cancel);

  // Approving runs the plan and cannot be undone from the page, so the header
  // button and the a key open the confirmation instead of posting. The dialog
  // script is the same one the shortcut sheet uses: Tab trapped, Esc, focus back
  // on whatever opened it.
  ${dialogScript({ dialogId: "approve-dialog", closeId: "approve-cancel", globalName: "bfApprove" })}
  var approveDialog = document.getElementById("approve-dialog");

  function askApprove() {
    if (saved || approved || closed) return;
    if (confirmNoDraft()) return;
    if (!approveDialog || !window.bfApprove) { approve(); return; }
    window.bfApprove.open();
  }
  function confirmApprove() {
    if (window.bfApprove) window.bfApprove.close();
    approve();
  }
  if (approveButton) approveButton.addEventListener("click", askApprove);
  var approveConfirm = document.getElementById("approve-confirm");
  if (approveConfirm) approveConfirm.addEventListener("click", confirmApprove);

  // The share and name dialogs. The fragment above holds their behaviour; this
  // is the wiring, which needs the page's own element handles.
  var shareButton = document.getElementById("share");
  var shareDialogNode = document.getElementById("share-dialog");
  var shareLinksEl = document.getElementById("share-links");
  var shareQrEl = document.getElementById("share-qr");
  var shareStop = document.getElementById("share-stop");
  var shareNew = document.getElementById("share-new");
  var shareNote = document.getElementById("share-note");
  var nameButton = document.getElementById("reviewer-name");
  var nameInput = document.getElementById("name-input");

  if (shareButton) shareButton.addEventListener("click", shareNow);
  if (shareStop) shareStop.addEventListener("click", stopSharing);
  if (shareNew) shareNew.addEventListener("click", newLink);
  ${dialogScript({ dialogId: "share-dialog", closeId: "share-close", globalName: "bfShare" })}

  if (nameButton) nameButton.addEventListener("click", askName);
  var nameSave = document.getElementById("name-save");
  if (nameSave) nameSave.addEventListener("click", saveName);
  ${dialogScript({ dialogId: "name-dialog", closeId: "name-cancel", globalName: "bfName" })}

  // Remember a selection made inside a block so clicking the rail button can
  // still quote it after the button press has collapsed the selection.
  document.addEventListener("mouseup", function (event) {
    if (!planEl || saved || approved || closed) return;
    var wrap = event.target && event.target.closest ? event.target.closest(".bf-block") : null;
    var quote = wrap && !wrap.querySelector(".bf-composer") ? selectionIn(wrap) : "";
    pendingQuote = wrap && quote ? { wrap: wrap, quote: quote } : null;
  });

  // The sheet's own wiring — trigger, close button, backdrop, Tab trap, and Esc —
  // is shared with browse; the page keeps only its own keymap.
  ${keysDialogScript("shortcuts")}

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      // The sheet owns its own Esc; this peels the composer, then the review.
      if (planEl && planEl.querySelector(".bf-composer")) { closeOpenComposer(); return; }
      cancel();
      return;
    }
    if (typing(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "?") { event.preventDefault(); window.bfKeys.toggle(); return; }
    // While the shortcut sheet is open it owns the keyboard.
    if (window.bfKeys.isOpen()) return;
    if (event.key === "j") {
      event.preventDefault();
      var down = moveActive(planEl, activeIndex, 1);
      if (down !== null) activeIndex = down;
      return;
    }
    if (event.key === "k") {
      event.preventDefault();
      var up = moveActive(planEl, activeIndex, -1);
      if (up !== null) activeIndex = up;
      return;
    }
    if (event.key === "c") {
      event.preventDefault();
      activeIndex = commentOnActive(composer(), activeIndex, blocks());
      return;
    }
    if (event.key === "a" && approveButton) { event.preventDefault(); askApprove(); return; }
    if (event.key === "s") { event.preventDefault(); if (saveButton) save(); else postComments(); return; }
  });

  // A closed tab is detected by the stream below: the server sees the last
  // client go away and cancels after a grace period, and a reload reconnects
  // inside it. A beacon here would cancel the review on every reload, including
  // the reload a 409 offers.

  window.addEventListener("scroll", updateProgress);
  window.addEventListener("resize", updateProgress);
  window.addEventListener("pagehide", settleStream);
  if (planEl) planEl.addEventListener("scroll", updateProgress);

  try {
    stream = new EventSource("/events?token=" + encodeURIComponent(token));
    stream.addEventListener("open", function () { connected = true; everConnected = true; updateState(); });
    stream.addEventListener("message", function (event) { refreshFromServer(event); });
    stream.addEventListener("error", function () {
      // The server ends the stream once the review is settled; keep showing the
      // terminal state rather than Offline.
      if (!saved && !approved && !closed) { connected = false; updateState(); }
    });
  } catch (error) {
    // The server still sees the POST; the stream is only for close detection.
    connected = false;
    everConnected = true;
    updateState();
  }

  ${THEME_TOGGLE_JS}

  // A reload during a review keeps this tab's unsaved work: the comments it added
  // and the composer it was typing into, which needs the blocks rendered first.
  var restoredTyping = restoreDraft();
  renderHeader();
  renderName();
  outlineItems = renderOutline(outlineList, outlineEntries());
  renderAll();
  reopenComposer(composer(), restoredTyping, { saved: saved, approved: approved, closed: closed }, blocks());
  updateProgress();
})();
`;
