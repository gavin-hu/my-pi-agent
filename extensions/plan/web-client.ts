/**
 * The browser review client, served as `/client.js`.
 *
 * Kept as one self-contained script (like `file-browse/client.ts`) with no
 * build step. Its document half — the inline and block Markdown rendering — is
 * `web-markdown.ts`, a fragment of the same IIFE interpolated below. It renders
 * the plan from the JSON data island using DOM text nodes only — plan and
 * comment text never becomes markup — renders each block
 * with its comment threads indented directly beneath it, highlights code by
 * copying only `tok-*` spans through `DOMParser`, builds the section outline
 * and review facts, and saves the annotation list back to the server. An
 * `EventSource` keeps a connection open so the server can tell when the tab is
 * gone; the explicit buttons are the primary save/cancel path.
 */

import { dialogScript, keysDialogScript, THEME_TOGGLE_JS } from "../../lib/web/index.ts";
import { WEB_CHROME_JS } from "./web-chrome.ts";
import { WEB_MARKDOWN_JS } from "./web-markdown.ts";

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
  var DRAFT_REFUSAL = "Add or discard the comment you are writing.";
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
  var stream = null;

  var planEl = document.getElementById("plan");
  var statusEl = document.getElementById("status");
  var stateEl = document.getElementById("review-state");
  var approveButton = document.getElementById("approve");
  var saveButton = document.getElementById("save");
  var cancelButton = document.getElementById("cancel");
  var outlineList = document.getElementById("outline-list");
  var progressEl = document.getElementById("progress-fill");

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

${WEB_CHROME_JS}

${WEB_MARKDOWN_JS}
  function closeComposer() {
    var open = planEl ? planEl.querySelector(".bf-composer") : null;
    if (open && open.parentNode) open.parentNode.removeChild(open);
    Array.prototype.forEach.call(planEl ? planEl.querySelectorAll(".bf-block--composing") : [], function (block) {
      block.classList.remove("bf-block--composing");
    });
    // The only status a composer leaves behind is the refusal to leave it; once
    // the draft is gone that sentence is stale.
    if (statusEl && statusEl.textContent === DRAFT_REFUSAL) setStatus("");
  }

  function selectionIn(wrap) {
    var selection = window.getSelection && window.getSelection();
    if (!selection || selection.isCollapsed) return "";
    var range = selection.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !wrap.contains(range.commonAncestorContainer)) return "";
    return selection.toString().replace(/\s+/g, " ").trim().slice(0, limits.quote);
  }

  function commentsBoxAfter(wrap) {
    var next = wrap.nextElementSibling;
    if (next && next.classList && next.classList.contains("bf-comments")) return next;
    var box = el("div", "bf-comments");
    wrap.insertAdjacentElement("afterend", box);
    return box;
  }

  // Enter submits a comment; Shift+Enter is left for the browser.
  function submitOnEnter(area, submit) {
    area.addEventListener("keydown", function (event) {
      // An IME uses Enter to commit a composition; submitting then would send a
      // half-typed comment.
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      submit();
    });
  }

  function openComposer(wrap, block, quote) {
    closeComposer();
    wrap.classList.add("bf-block--composing");
    var composer = el("div", "bf-composer");
    if (quote) {
      var chip = el("div", "bf-quote-chip");
      chip.textContent = "\u201c" + quote + "\u201d";
      composer.appendChild(chip);
    }
    var area = el("textarea", "bf-textarea");
    area.placeholder = "Leave feedback on this part of the plan (Enter to add)";
    area.setAttribute("aria-label", "Comment");
    area.maxLength = limits.comment;
    composer.appendChild(area);
    var row = el("div", "bf-composer__row");
    var cancel = el("button"); cancel.type = "button"; cancel.className = "bf-btn"; cancel.textContent = "Cancel";
    cancel.addEventListener("click", closeComposer);
    var add = el("button"); add.type = "button"; add.className = "bf-btn bf-btn--primary"; add.textContent = "Add comment";
    var submit = function () {
      var comment = area.value.replace(/\s+/g, " ").trim();
      if (!comment) { area.focus(); return; }
      if (annotations.length >= limits.comments) { setStatus("Comment limit reached (" + limits.comments + ").", "error"); return; }
      annotations.push(quote ? { anchor: block.start, quote: quote, comment: comment } : { anchor: block.start, comment: comment });
      dirty = true;
      renderPlan();
    };
    add.addEventListener("click", submit);
    submitOnEnter(area, submit);
    row.appendChild(cancel); row.appendChild(add); composer.appendChild(row);
    commentsBoxAfter(wrap).appendChild(composer);
    area.focus();
  }

  function startEdit(card, index) {
    var annotation = annotations[index];
    card.textContent = "";
    var area = el("textarea", "bf-textarea");
    area.value = annotation.comment;
    area.setAttribute("aria-label", "Edit comment");
    area.maxLength = limits.comment;
    card.appendChild(area);
    var row = el("div", "bf-comment__row");
    var cancel = el("button"); cancel.type = "button"; cancel.className = "bf-btn"; cancel.textContent = "Cancel";
    cancel.addEventListener("click", renderPlan);
    var apply = el("button"); apply.type = "button"; apply.className = "bf-btn bf-btn--primary"; apply.textContent = "Save";
    apply.addEventListener("click", function () {
      var comment = area.value.replace(/\s+/g, " ").trim();
      if (!comment) { area.focus(); return; }
      annotation.comment = comment;
      dirty = true;
      renderPlan();
    });
    submitOnEnter(area, function () { apply.click(); });
    row.appendChild(cancel); row.appendChild(apply); card.appendChild(row);
    area.focus();
  }

  // Deleting a comment is one click, so it is undoable rather than confirmed: the
  // removed note is held for a few seconds and offered back in the header.
  var undo = null;

  function clearUndo() {
    if (undo && undo.timer) window.clearTimeout(undo.timer);
    if (undo && undo.button && undo.button.parentNode) undo.button.parentNode.removeChild(undo.button);
    undo = null;
  }

  function offerUndo(index, annotation) {
    var controls = document.querySelector(".review-controls");
    clearUndo();
    if (!controls) return;
    var button = el("button", "bf-btn");
    button.type = "button";
    button.id = "undo-delete";
    button.textContent = "Undo delete";
    button.addEventListener("click", function () {
      annotations.splice(Math.min(index, annotations.length), 0, annotation);
      dirty = true;
      clearUndo();
      renderPlan();
      setStatus("Comment restored.", "saved");
    });
    controls.appendChild(button);
    undo = { button: button, timer: window.setTimeout(clearUndo, 6000) };
  }

  function removeComment(index) {
    var annotation = annotations[index];
    if (!annotation) return;
    annotations.splice(index, 1);
    dirty = true;
    renderPlan();
    offerUndo(index, annotation);
    setStatus("Comment deleted.");
  }

  function renderCommentCards(box, list) {
    list.forEach(function (annotation) {
      var index = annotations.indexOf(annotation);
      var card = el("div", "bf-comment");
      var head = el("div", "bf-comment__head");
      var label = el("span", "bf-comment__label"); label.textContent = "Review";
      head.appendChild(label);
      head.appendChild(el("span", "bf-comment__spacer"));
      var actions = el("div", "bf-comment__actions");
      var edit = el("button"); edit.type = "button"; edit.className = "bf-btn"; edit.textContent = "Edit";
      edit.addEventListener("click", function () { startEdit(card, index); });
      var remove = el("button"); remove.type = "button"; remove.className = "bf-btn"; remove.textContent = "Delete";
      remove.addEventListener("click", function () { removeComment(index); });
      actions.appendChild(edit); actions.appendChild(remove); head.appendChild(actions);
      card.appendChild(head);
      if (annotation.quote) {
        var quote = el("div", "bf-comment__quote");
        quote.textContent = "\u201c" + annotation.quote + "\u201d";
        card.appendChild(quote);
      }
      var body = el("div", "bf-comment__body");
      body.textContent = annotation.comment;
      card.appendChild(body);
      box.appendChild(card);
    });
  }

  function renderComments(container, anchor) {
    var mine = annotations.filter(function (annotation) { return annotation.anchor === anchor; });
    if (mine.length === 0) return;
    var box = el("div", "bf-comments");
    renderCommentCards(box, mine);
    container.appendChild(box);
  }

  function observeSections() {
    if (sectionObserver && sectionObserver.disconnect) sectionObserver.disconnect();
    sectionObserver = null;
    if (!outlineList || !window.IntersectionObserver) return;
    var links = {};
    Array.prototype.forEach.call(outlineList.querySelectorAll("a"), function (link) {
      links[link.getAttribute("data-id")] = link;
    });
    var headings = Array.prototype.slice.call(planEl.querySelectorAll(".bf-block[id]"));
    if (headings.length === 0) return;
    sectionObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        Array.prototype.forEach.call(outlineList.querySelectorAll("a"), function (link) {
          link.removeAttribute("aria-current");
        });
        var link = links[entry.target.id];
        if (link) link.setAttribute("aria-current", "true");
      });
    }, { rootMargin: "-88px 0px -68% 0px", threshold: 0 });
    headings.forEach(function (heading) { sectionObserver.observe(heading); });
  }

  function renderOutline() {
    outlineItems = {};
    if (!outlineList) return;
    outlineList.replaceChildren();
    var items = Array.isArray(data.outline) ? data.outline : [];
    items.forEach(function (item) {
      var li = el("li", "lvl-" + item.level);
      var link = el("a");
      link.href = "#" + item.id;
      link.setAttribute("data-id", item.id);
      var label = el("span", "review-nav__link");
      label.textContent = item.text;
      link.appendChild(label);
      if (item.changed) {
        var dot = el("span", "review-changed");
        dot.setAttribute("role", "img");
        dot.setAttribute("aria-label", "Changed since your last review");
        dot.title = "Changed since your last review";
        link.appendChild(dot);
      }
      var count = el("span", "review-nav__count");
      count.hidden = true;
      link.appendChild(count);
      li.appendChild(link);
      outlineList.appendChild(li);
      outlineItems[item.line] = count;
    });
  }

  // The section a source line belongs to: the last heading at or before it.
  function sectionFor(line) {
    var items = Array.isArray(data.outline) ? data.outline : [];
    var found = null;
    items.forEach(function (item) { if (item.line <= line) found = item; });
    return found;
  }

  // Review facts: the plan's step progress, and the comments per section.
  function renderFacts() {
    // The server counts the same step list approval seeds, so this never
    // disagrees with the todo list over a checkbox outside the Steps section.
    var steps = data.steps || { done: 0, total: 0 };
    // A plan with no Steps section has no progress to show; 0/0 is noise.
    var stepFact = document.getElementById("step-fact");
    if (stepFact) stepFact.hidden = !steps.total;
    var stepFill = document.getElementById("step-fill");
    if (stepFill) stepFill.style.width = (steps.total > 0 ? Math.round((steps.done / steps.total) * 100) : 0) + "%";
    var stepCount = document.getElementById("step-count");
    if (stepCount) stepCount.textContent = steps.done + "/" + steps.total;
    var totalEl = document.getElementById("comment-total");
    if (totalEl) totalEl.textContent = String(annotations.length);
    Object.keys(outlineItems).forEach(function (line) { outlineItems[line].hidden = true; });
    annotations.forEach(function (annotation) {
      var section = sectionFor(annotation.anchor);
      if (!section) return;
      var count = outlineItems[section.line];
      if (!count) return;
      var value = count.hidden ? 0 : Number(count.textContent);
      count.textContent = String(value + 1);
      count.hidden = false;
    });
    updateState();
  }

  function blockElements() {
    return planEl ? Array.prototype.slice.call(planEl.querySelectorAll(".bf-block")) : [];
  }

  function setActive(index) {
    var blocks = blockElements();
    if (blocks.length === 0) return;
    activeIndex = Math.max(0, Math.min(blocks.length - 1, index));
    blocks.forEach(function (block, at) { block.classList.toggle("bf-block--active", at === activeIndex); });
    var current = blocks[activeIndex];
    if (current && current.scrollIntoView) current.scrollIntoView({ block: "nearest" });
  }

  function moveActive(delta) {
    var blocks = blockElements();
    if (blocks.length === 0) return;
    if (activeIndex < 0) { setActive(delta < 0 ? blocks.length - 1 : 0); return; }
    setActive(activeIndex + delta);
  }

  function commentOnActive() {
    var blocks = blockElements();
    if (blocks.length === 0) return;
    if (activeIndex < 0) setActive(0);
    var wrap = blockElements()[Math.max(0, activeIndex)];
    if (!wrap) return;
    var line = Number(wrap.getAttribute("data-line"));
    var block = (data.blocks || []).filter(function (item) { return item.start === line; })[0];
    if (block) openComposer(wrap, block, "");
  }

  function renderPlan() {
    if (!planEl) return;
    closeComposer();
    pendingQuote = null;
    var scrollTop = planEl.scrollTop;
    planEl.replaceChildren();
    var blocks = Array.isArray(data.blocks) ? data.blocks : [];
    var anchored = {};
    blocks.forEach(function (block) {
      if (block.kind === "blank") return;
      anchored[block.start] = true;
      var wrap = el("div", "bf-block");
      wrap.setAttribute("data-line", String(block.start));
      wrap.setAttribute("data-kind", String(block.kind));
      if (block.kind === "heading") wrap.id = "s-" + block.start;
      renderBlockContent(wrap, block);
      var mine = annotations.filter(function (annotation) { return annotation.anchor === block.start; });
      if (mine.length > 0) wrap.classList.add("bf-block--commented");
      var rail = el("div", "bf-block__rail");
      var add = el("button", "bf-block__add");
      add.type = "button";
      add.textContent = "+";
      add.setAttribute("aria-label", "Comment on this block");
      add.addEventListener("click", function () {
        var quote = pendingQuote && pendingQuote.wrap === wrap ? pendingQuote.quote : selectionIn(wrap);
        pendingQuote = null;
        openComposer(wrap, block, quote);
      });
      rail.appendChild(add);
      if (mine.length > 0) {
        var badge = el("span", "bf-block__count");
        badge.textContent = String(mine.length);
        badge.title = mine.length === 1 ? "1 review comment" : mine.length + " review comments";
        rail.appendChild(badge);
      }
      wrap.appendChild(rail);
      wrap.addEventListener("focusin", function () { setActive(blockElements().indexOf(wrap)); });
      planEl.appendChild(wrap);
      renderComments(planEl, block.start);
    });
    var orphans = annotations.filter(function (annotation) { return !anchored[annotation.anchor]; });
    if (orphans.length > 0) {
      var box = el("div", "bf-comments bf-comments--orphans");
      var note = el("p"); note.textContent = "Comments not attached to a current block";
      box.appendChild(note);
      renderCommentCards(box, orphans);
      planEl.appendChild(box);
    }
    planEl.scrollTop = scrollTop;
    // The DOM was rebuilt, so the active block's class is gone; restore it in
    // place rather than scrolling, so j/k resume where the reviewer was.
    var active = activeIndex >= 0 ? blockElements()[activeIndex] : null;
    if (active) active.classList.add("bf-block--active");
    renderFacts();
    observeSections();
    updateState();
  }


  // Save and approve share the same POST shape; only the route, the settled
  // flag, and the wording differ. Both persist the current annotations.
  function submit(url, okText, failText, mark) {
    fetch(url + "?token=" + encodeURIComponent(token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ annotations: annotations })
    }).then(function (response) {
      if (response.ok) {
        mark();
        dirty = false;
        settleStream();
        setStatus(okText, "saved");
        lockActions();
        updateState();
        return;
      }
      if (response.status === 409) {
        setStatus("The plan changed on disk \u2014 reload to review again.", "error");
        if (approveButton) approveButton.disabled = true;
        if (saveButton) saveButton.disabled = true;
        offerReload();
        return;
      }
      // Surface the server's own reason (a malformed comment, a stale body)
      // rather than a bare status code.
      return response.json().then(
        function (payload) { throw new Error(payload && payload.error ? payload.error : "server returned " + response.status); },
        function () { throw new Error("server returned " + response.status); }
      );
    }).catch(function (error) {
      setStatus(failText + error.message, "error");
    });
  }

  // A composer holds text the page has not committed, so the ways off the page
  // refuse while it does: leaving would drop what the reviewer typed.
  function draftTextarea() {
    var open = planEl ? planEl.querySelector(".bf-composer") : null;
    var area = open ? open.querySelector("textarea") : null;
    return area && area.value.trim() ? area : null;
  }
  function guardDraft() {
    var area = draftTextarea();
    if (!area) return false;
    setStatus(DRAFT_REFUSAL, "error");
    area.focus();
    return true;
  }

  function save() {
    if (saved || approved || closed) return;
    if (guardDraft()) return;
    setStatus("Saving\u2026");
    submit("/api/feedback", "Saved \u2014 return to Pi to continue.", "Could not save: ", function () { saved = true; });
  }

  function approve() {
    if (saved || approved || closed) return;
    setStatus("Approving\u2026");
    submit("/api/approve", "Approved \u2014 return to Pi to continue.", "Could not approve: ", function () { approved = true; });
  }

  function cancel() {
    if (saved || approved || closed) return;
    if (guardDraft()) return;
    closed = true;
    settleStream();
    lockActions();
    setStatus("Closing\u2026");
    updateState();
    fetch("/api/cancel?token=" + encodeURIComponent(token), { method: "POST" }).catch(function () {}).then(function () {
      setStatus("Closed \u2014 return to Pi.");
      updateState();
    });
  }

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
    if (guardDraft()) return;
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

  function typing(target) {
    var tag = target && target.tagName ? target.tagName : "";
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (target && target.isContentEditable);
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      // The sheet owns its own Esc; this peels the composer, then the review.
      if (planEl && planEl.querySelector(".bf-composer")) { closeComposer(); return; }
      cancel();
      return;
    }
    if (typing(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "?") { event.preventDefault(); window.bfKeys.toggle(); return; }
    // While the shortcut sheet is open it owns the keyboard.
    if (window.bfKeys.isOpen()) return;
    if (event.key === "j") { event.preventDefault(); moveActive(1); return; }
    if (event.key === "k") { event.preventDefault(); moveActive(-1); return; }
    if (event.key === "c") { event.preventDefault(); commentOnActive(); return; }
    if (event.key === "a" && approveButton) { event.preventDefault(); askApprove(); return; }
    if (event.key === "s") { event.preventDefault(); save(); return; }
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

  renderHeader();
  renderOutline();
  renderPlan();
  updateProgress();
})();
`;
