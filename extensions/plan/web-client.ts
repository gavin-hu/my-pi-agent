/**
 * The browser review client, served as `/client.js`.
 *
 * Served as one script with no build step, assembled from typed source: the element builder,
 * typing test, status paint, and JSON POST come from `lib/web/client-runtime.ts`, and every
 * rule the page has lives in its own `web-*.ts` module, interpolated below — the outline,
 * the blocks and their navigation, the composer, the draft guard, the frame, the settlement,
 * the keymap, and the Markdown, chrome, comments, and collaboration halves.
 *
 * What is left here is the composition root, deliberately: the element handles, the state
 * the rules are handed, one adapter per rule that names it without arguments, the listeners
 * that attach them, the stream that keeps a tab's presence known, and the boot order.
 * None of it decides anything a test could disagree with — a rule that does belongs in a
 * module, where it can be typed and driven.
 *
 * It renders the plan from the JSON data island using DOM text nodes only — plan and comment
 * text never becomes markup — with each block's comment threads indented beneath it, code
 * highlighted by copying only `tok-*` spans through `DOMParser`, and the annotation list
 * saved back to the server.
 */

import {
	CLIENT_BASE_JS,
	CLIENT_RUNTIME_JS,
	dialogScript,
	INLINE_MARKDOWN_JS,
	keysDialogScript,
	THEME_TOGGLE_JS,
} from "../../lib/web/index.ts";
import { WEB_CHROME_JS } from "./web-chrome.ts";
import { WEB_COMMENTS_JS } from "./web-comments.ts";
import { WEB_CONFIRM_JS } from "./web-confirm.ts";
import { WEB_COLLAB_JS } from "./web-collab.ts";
import { WEB_MARKDOWN_JS } from "./web-markdown.ts";
import { WEB_BLOCKS_JS } from "./web-blocks.ts";
import { WEB_NOTE_JS } from "./web-note.ts";
import { WEB_COMPOSER_JS } from "./web-composer.ts";
import { WEB_DRAFT_JS } from "./web-draft.ts";
import { WEB_OUTLINE_JS } from "./web-outline.ts";
import { WEB_KEYS_JS } from "./web-keys.ts";
import { WEB_PLAN_JS } from "./web-plan.ts";
import { WEB_SETTLE_JS } from "./web-settle.ts";
import { MORE_ACTIONS_MAX, PLAN_COLLAPSE_MAX } from "./web-page.ts";

export const REVIEW_CLIENT_JS = String.raw`(function () {
  "use strict";
${CLIENT_BASE_JS}

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
  // Who the server says is looking: the owner approves, a reviewer comments, a viewer reads.
  // A role this page does not know is an owner's, which is the stricter guess: it draws the
  // controls, and the server refuses every write the browser then sends.
  var role = data.role === "reviewer" || data.role === "viewer" ? data.role : "owner";
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
  var dirty = false;
  /** Whether the single keys answer; the ? sheet's toggle sets it, and a reload reads it. */
  var shortcutsOn = true;
  /** The card a write asked the next frame to focus; the renderer consumes it once. */
  var pendingFocus = null;

  var sectionObserver = null;
  var pendingQuote = null;
  var activeIndex = -1;
  /** What the reader asked the plan to show: every block, the changed ones, or the annotated. */
  var view = "all";
  var outlineItems = {};
  /** The island's blocks, or none: one place the client reads them for navigation. */
  function blocks() {
    return Array.isArray(data.blocks) ? data.blocks : [];
  }

  /** The island's changed blocks, or none: the whole list is scanned, because it is short. */
  function changedBlocks() {
    return Array.isArray(data.changed) ? data.changed : [];
  }

  /** The island's outline, or none: the one place the client reads it for the outline. */
  function outlineEntries() {
    return Array.isArray(data.outline) ? data.outline : [];
  }
  var stream = null;

  var planEl = document.getElementById("plan");
  var statusEl = document.getElementById("status");
  // The sentence a screen reader hears: the visible line is painted, never announced.
  var announceEl = document.getElementById("review-announce");
  var stateEl = document.getElementById("review-state");
  var approveButton = document.getElementById("approve");
  var saveButton = document.getElementById("save");
  var postButton = document.getElementById("post");
  var cancelButton = document.getElementById("cancel");
  var outlineList = document.getElementById("outline-list");
  var viewNoteEl = document.getElementById("review-note");
  var reloadEl = document.getElementById("reload-hint");

${CLIENT_RUNTIME_JS}

${WEB_OUTLINE_JS}

${WEB_BLOCKS_JS}

${WEB_NOTE_JS}

${WEB_KEYS_JS}

${WEB_SETTLE_JS}

${WEB_PLAN_JS}

${WEB_COMPOSER_JS}

${WEB_DRAFT_JS}

${WEB_CHROME_JS}

${WEB_COMMENTS_JS}

${WEB_COLLAB_JS}

${INLINE_MARKDOWN_JS}

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
      settled: function () { return saved || approved || closed; },
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
      changed: function (line) { return changedBlocks().indexOf(line) >= 0; },
      annotations: function () { return annotations; },
      activeIndex: function () { return activeIndex; },
      setActiveIndex: function (index) { activeIndex = index; },
      pendingQuote: function () { return pendingQuote; },
      clearPendingQuote: function () { pendingQuote = null; },
      focusAfter: function () { return pendingFocus; },
      clearFocusAfter: function () { pendingFocus = null; },
      settled: function () { return saved || approved || closed; },
      composer: composer,
      // A viewer's page has nothing to write, so no rail button is drawn at all: a control
      // that opened a composer whose note could never be saved is not omitted, it is absent.
      canComment: function () { return role !== "viewer"; },
      renderBlock: renderBlockContent,
      renderComments: renderComments,
      renderCommentCards: renderCommentCards,
      selectionIn: selectionIn,
      open: openComposer,
      facts: facts,
      updateState: updateState,
    };
  }

  /**
   * Apply the current view, and say beside the switch what it hid.
   *
   * The note sits under the control the reader pressed rather than in the header: the count
   * is the one fact that undoes a filtered plan reading as a short one, so it belongs beside
   * the switch. It is rewritten from the view on every render, which is why a sentence can no
   * longer outlive the view that wrote it.
   */
  function syncView() {
    var counts = applyView(planEl, view);
    var offered = views();
    var buttons = document.querySelectorAll("[data-view]");
    for (var i = 0; i < buttons.length; i++) {
      var button = buttons[i];
      var name = button.getAttribute("data-view");
      button.setAttribute("aria-pressed", name === view ? "true" : "false");
      // A view this page cannot offer is off, and says why: nothing to compare against is
      // not an empty view.
      button.disabled = offered.indexOf(name) < 0;
      if (name === "changed")
        button.title =
          offered.indexOf("changed") >= 0
            ? "Only what this review changed"
            : "No earlier review of this plan to compare against";
    }
    if (viewNoteEl) viewNoteEl.textContent = viewNote(view, counts);
  }

  /**
   * The order this page's views cycle in, which is also the set it can offer.
   *
   * The Changed view needs an earlier review to compare against, and a plan whose baseline
   * carries no block marks has none: the button is off and the key skips it.
   */
  function views() {
    return data.blockMarks === true ? ["all", "changed", "comments"] : ["all", "comments"];
  }

  /**
   * What the switch says about the view it is showing.
   *
   * The sentences belong to web-note.ts, keyed by view and by which nothing the view found;
   * the one rule here is that a settled review says nothing, because the header already
   * carries how it ended.
   */
  function viewNote(name, counts) {
    if (saved || approved || closed) return "";
    return reviewNote(name, counts);
  }

  /**
   * Walk from the active block to the next one that carries a comment.
   *
   * The block order is the document's, so "next" means further down the plan, not the next
   * comment by arrival: a reader walking notes is reading the document. A filtered view can
   * hide a commented block, and a hidden one is not a place to send the reader, so the step
   * skips it the way the block walk does. Nothing repaints, so no draft is at risk.
   */
  function moveComment(delta) {
    var list = blockElements(planEl);
    var start = activeIndex >= 0 ? activeIndex : delta > 0 ? -1 : list.length;
    for (var step = start + delta; step >= 0 && step < list.length; step += delta) {
      var block = list[step];
      if (!block || block.hidden === true) continue;
      if (!commented(block)) continue;
      var next = setActive(planEl, step);
      if (next !== null) activeIndex = next;
      if (block.scrollIntoView) block.scrollIntoView({ block: "center" });
      return;
    }
  }

  /**
   * Cycle the panel's views, skipping the one this page cannot offer.
   *
   * The repaint closes the composer, so a half-written comment refuses first, the way the
   * view buttons do.
   */
  function cycleView() {
    if (confirmNoDraft()) return;
    var order = views();
    var at = order.indexOf(view);
    view = order[(at + 1) % order.length] || "all";
    renderAll();
  }

  /**
   * Repaint the page: the rail first, then the frame that reads it.
   *
   * The outline is rebuilt before the frame because both the facts and the section watcher
   * read the links and the counters it makes: a live plan change that repainted only the
   * body left the sidebar listing the headings it replaced, and the comment counts went to
   * the nodes those headings were in. This is the one repaint entry — every fragment, the
   * view switch, and the boot path below come through it.
   */
  // A write asks the next frame for the card it changed; the frame clears the request.
  function requestFocus(line, index) {
    pendingFocus = { line: line, index: index };
  }

  function renderAll() {
    outlineItems = renderOutline(outlineList, outlineEntries());
    sectionObserver = renderPlanFrame(planFrame(), closeOpenComposer, observeSections, sectionObserver);
    syncView();
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
      base: pageBase,
      role: function () { return role; },
      mine: function () { return annotations.filter(isMine); },
      annotations: function () { return annotations; },
      // The island's own revision: the server writes only into the plan this page read.
      rev: function () { return typeof data.rev === "string" ? data.rev : ""; },
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

  // Save, Post and Back to Pi share one confirmation: the review has comments the file does
  // not have, and the action they end would drop them. The words and the action behind the
  // accept button change; the dialog runtime, the Tab trap and the Esc are the shared one.
  ${dialogScript({ dialogId: "confirm-dialog", closeId: "confirm-cancel", globalName: "bfConfirm" })}
  var confirmDialog = document.getElementById("confirm-dialog");
  var confirmTitle = document.getElementById("confirm-title");
  var confirmBody = document.getElementById("confirm-body");
  var confirmAccept = document.getElementById("confirm-accept");

${WEB_CONFIRM_JS}

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
    rememberSelection(event.target, {
      planEl: planEl,
      settled: function () { return saved || approved || closed; },
      selectionIn: selectionIn,
      setPending: function (quote) { pendingQuote = quote; },
    });
  });

  // The sheet's own wiring — trigger, close button, backdrop, Tab trap, and Esc —
  // is shared with browse; the page keeps only its own keymap.
  ${keysDialogScript("keys-open")}

  // The reader's own switch, in the sheet that documents the keys: a checkbox, persisted for
  // this browser, that makes the single keys inert while the buttons, Escape, and ? stay.
  var shortcutsToggle = null;
  var shortcutsList = null;

  function applyShortcuts() {
    if (shortcutsToggle) shortcutsToggle.checked = shortcutsOn;
    if (shortcutsList) shortcutsList.classList.toggle("bf-keys--off", !shortcutsOn);
    var hints = document.querySelector(".review-hints");
    if (hints) hints.hidden = !shortcutsOn;
    var controls = document.querySelectorAll("[data-keyshortcut]");
    for (var i = 0; i < controls.length; i++) {
      var control = controls[i];
      var key = control.getAttribute("data-keyshortcut");
      if (shortcutsOn) control.setAttribute("aria-keyshortcuts", key);
      else control.removeAttribute("aria-keyshortcuts");
    }
  }

  function setShortcuts(on) {
    shortcutsOn = on;
    try { window.localStorage.setItem("bf-review-shortcuts", on ? "on" : "off"); } catch (error) {}
    applyShortcuts();
  }

  function setupShortcuts() {
    var stored = null;
    try { stored = window.localStorage.getItem("bf-review-shortcuts"); } catch (error) { stored = null; }
    shortcutsOn = stored !== "off";
    var panel = document.querySelector("#keys-dialog .bf-dialog__panel");
    shortcutsList = document.querySelector("#keys-dialog .bf-keys");
    if (panel && !document.getElementById("shortcuts-toggle")) {
      var row = el("label", "bf-keys__toggle");
      shortcutsToggle = el("input");
      shortcutsToggle.type = "checkbox";
      shortcutsToggle.id = "shortcuts-toggle";
      shortcutsToggle.checked = shortcutsOn;
      shortcutsToggle.addEventListener("change", function () {
        setShortcuts(shortcutsToggle.checked);
        setStatus(shortcutsToggle.checked ? "Keyboard shortcuts on." : "Keyboard shortcuts off.");
      });
      row.appendChild(shortcutsToggle);
      row.appendChild(el("span", "", "Keyboard shortcuts"));
      panel.appendChild(row);
    }
    applyShortcuts();
  }

  /**
   * What a key may do, built where the state and the handlers are.
   *
   * The listener below stays in the bundle with the rest of the wiring; the map of key to
   * action is web-keys.ts, which is the part with a rule to it.
   */
  function keyActions() {
    return {
      role: role,
      composerOpen: function () { return !!(planEl && planEl.querySelector(".bf-composer")); },
      closeComposer: closeOpenComposer,
      editOpen: function () { return !!(planEl && planEl.querySelector(".bf-comment textarea")); },
      closeEdit: closeOpenEdit,
      modalOpen: function () {
        return !!((window.bfApprove && window.bfApprove.isOpen()) ||
          (window.bfConfirm && window.bfConfirm.isOpen()) ||
          (window.bfShare && window.bfShare.isOpen()) ||
          (window.bfName && window.bfName.isOpen()));
      },
      shortcutsOn: function () { return shortcutsOn; },
      cancel: askCancel,
      sheetOpen: function () { return window.bfKeys.isOpen(); },
      toggleSheet: function () { window.bfKeys.toggle(); },
      moveActive: function (delta) {
        var next = moveActive(planEl, activeIndex, delta);
        if (next !== null) activeIndex = next;
      },
      moveComment: moveComment,
      cycleView: cycleView,
      commentOnActive: function () { activeIndex = commentOnActive(composer(), activeIndex, blocks()); },
      askApprove: askApprove,
      save: askSave,
      postComments: askPost,
      hasSaveControl: function () { return !!saveButton; },
      hasApproveControl: function () { return !!approveButton; },
      typing: typing,
    };
  }

  var viewButtons = document.querySelectorAll("[data-view]");
  for (var v = 0; v < viewButtons.length; v++) {
    viewButtons[v].addEventListener("click", function (event) {
      var next = event.target && event.target.getAttribute ? event.target.getAttribute("data-view") : null;
      if (next !== "all" && next !== "changed" && next !== "comments") return;
      // The filter repaints the document, which closes the composer: a half-written
      // comment would go with it, so the click refuses the way the ways off the page do.
      if (confirmNoDraft()) return;
      view = next;
      renderAll();
    });
  }

  document.addEventListener("keydown", function (event) {
    handleKey(event, keyActions());
  });

  // A closed tab is detected by the stream below: the server sees the last
  // client go away and cancels after a grace period, and a reload reconnects
  // inside it. A beacon here would cancel the review on every reload, including
  // the reload a 409 offers.

  // The one reload control both stale reasons offer (a conflict, or a stream that has gone)
  // is the kit's chip, so the page wires it here rather than building a button of its own.
  if (reloadEl) reloadEl.addEventListener("click", function () { window.location.reload(); });

  // The stream's job is noticing a closed tab and saying whether this page is still true; it
  // never writes. One state machine for every served page, and this page's words for it —
  // which is also why the kit closes it as the page leaves, and this page does not.
  stream = liveStream({
    url: pageBase() + "/events",
    token: token,
    words: function (state) { liveState = state; updateState(); },
    frame: refreshFromServer,
  });

  ${THEME_TOGGLE_JS}

  // A reload during a review keeps this tab's unsaved work: the comments it added
  // and the composer it was typing into, which needs the blocks rendered first. A viewer
  // writes nothing, so it has no draft to keep and none to restore.
  var restoredTyping = role === "viewer" ? undefined : restoreDraft();
  // Two folds, at boot only: the sections list under the shell's band width — the switch and its
  // count sit above it, so a reader keeps the filter — and the row's quieter actions on a phone.
  // A reader who opens either afterwards is not fought by a repaint, and one who shrinks the
  // window keeps what they had; that trade is the reason this runs once and not on every resize.
  var folds = { "review-sections": ${PLAN_COLLAPSE_MAX}, "review-more": ${MORE_ACTIONS_MAX} };
  for (var foldId in folds) {
    var fold = document.getElementById(foldId);
    if (fold && window.matchMedia && window.matchMedia("(max-width:" + folds[foldId] + "px)").matches) fold.open = false;
  }
  setupShortcuts();
  renderName();
  renderAll();
  if (role !== "viewer")
    reopenComposer(composer(), restoredTyping, { saved: saved, approved: approved, closed: closed }, blocks());
})();
`;
