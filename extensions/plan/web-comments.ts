/**
 * The review page's comment threads: selection quotes, the composer, the cards.
 *
 * A fragment of the same IIFE `web-client.ts` ships (`WEB_COMMENTS_JS` is
 * interpolated into `REVIEW_CLIENT_JS`), kept apart so what a comment *is* — its
 * anchor, its author, and who may edit it — is read in one place. It mutates the
 * page's `annotations` array and asks the page to repaint; it owns no state.
 */

export const WEB_COMMENTS_JS = String.raw`  function selectionIn(wrap) {
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

  // One seam for "this writer changed a comment": the unsaved marker now, and the
  // draft this tab keeps across a reload beside it.
  function markDirty() {
    dirty = true;
    saveDraft();
  }

  // The draft is this tab's own: the comments this writer added and has not saved,
  // and the text in a composer that has not become a comment yet, keyed by the plan
  // revision the server rendered. It never travels to the server, and nothing
  // another writer added is kept here.
  var DRAFT_KEY = "bf-review-draft";
  var DRAFT_LIMIT = 131072;

  /** The open composer's block line and text, or null when nothing is being typed. */
  function typingOf() {
    var area = draftTextarea();
    var wrap = area && area.closest ? area.closest(".bf-block") : null;
    var anchor = wrap ? Number(wrap.getAttribute("data-line")) : -1;
    if (!area || !(anchor >= 0) || area.value === "") return null;
    return { anchor: anchor, text: area.value };
  }

  function saveDraft() {
    if (saved || approved || closed) return;
    var mine = annotations.filter(isMine);
    var typing = typingOf();
    if (mine.length === 0 && !typing) { clearDraft(); return; }
    try {
      var record = { rev: String(data.rev || ""), mine: mine };
      if (typing) record.typing = typing;
      var text = JSON.stringify(record);
      if (text.length > DRAFT_LIMIT) return;
      window.sessionStorage.setItem(DRAFT_KEY, text);
    } catch (error) {}
  }

  function clearDraft() {
    try { window.sessionStorage.removeItem(DRAFT_KEY); } catch (error) {}
  }

  /**
   * Put this tab's unsaved work back: after a reload of the same plan, and after
   * another writer's comment arrived and the island was re-read. A draft for a
   * different plan revision is stale, so it is dropped rather than re-anchored.
   * Returns the composer text to reopen, which needs the blocks to have rendered.
   */
  function restoreDraft() {
    var raw = null;
    try { raw = window.sessionStorage.getItem(DRAFT_KEY); } catch (error) { raw = null; }
    if (!raw) return null;
    var draft = null;
    try { draft = JSON.parse(raw); } catch (error) { draft = null; }
    var mine = draft && Array.isArray(draft.mine) ? draft.mine : [];
    var typing = draft && draft.typing && typeof draft.typing.text === "string" ? draft.typing : null;
    if (!draft || draft.rev !== String(data.rev || "") || (mine.length === 0 && !typing)) {
      clearDraft();
      return null;
    }
    if (mine.length > 0) {
      annotations = annotations.filter(function (annotation) { return !isMine(annotation); }).concat(mine);
      dirty = true;
    }
    return typing;
  }

  function openComposer(wrap, block, quote, initial) {
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
    if (initial) area.value = initial;
    // Every keystroke is this tab's draft, so a reload while typing costs nothing.
    area.addEventListener("input", function () { saveDraft(); });
    composer.appendChild(area);
    var row = el("div", "bf-composer__row");
    var cancel = el("button"); cancel.type = "button"; cancel.className = "bf-btn"; cancel.textContent = "Cancel";
    cancel.addEventListener("click", closeComposer);
    var add = el("button"); add.type = "button"; add.className = "bf-btn bf-btn--primary"; add.textContent = "Add comment";
    var submit = function () {
      if (closed) { setStatus("The review is closed; this comment was not added.", "error"); return; }
      if (role === "reviewer" && !reviewerName) { askName(); return; }
      var comment = area.value.replace(/\s+/g, " ").trim();
      if (!comment) { area.focus(); return; }
      if (annotations.length >= limits.comments) { setStatus("Comment limit reached (" + limits.comments + ").", "error"); return; }
        var entry = quote ? { anchor: block.start, quote: quote, comment: comment } : { anchor: block.start, comment: comment };
      if (role === "reviewer") entry.author = reviewerName;
      annotations.push(entry);
      // Close first: the text is now a comment, so the draft keeps one or the other.
      closeComposer();
      markDirty();
      setStatus("Comment added.");
      renderPlan();
    };
    add.addEventListener("click", submit);
    submitOnEnter(area, submit);
    row.appendChild(cancel); row.appendChild(add); composer.appendChild(row);
    commentsBoxAfter(wrap).appendChild(composer);
    area.focus();
    // A restored draft resumes where it left off, with the caret at its end.
    if (initial) area.setSelectionRange(area.value.length, area.value.length);
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
      markDirty();
      setStatus("Comment updated.");
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
      markDirty();
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
    markDirty();
    renderPlan();
    offerUndo(index, annotation);
    setStatus("Comment deleted.");
  }

  // A comment belongs to whoever wrote it: an untagged one is the owner's, a
  // tagged one is that reviewer's. Everyone else's is read-only on this page.
  function isMine(annotation) {
    if (role === "owner") return !annotation.author;
    return !!reviewerName && annotation.author === reviewerName;
  }

  function renderCommentCards(box, list) {
    list.forEach(function (annotation) {
      var index = annotations.indexOf(annotation);
      var card = el("div", "bf-comment");
      var head = el("div", "bf-comment__head");
      var label = el("span", annotation.author ? "bf-comment__label bf-comment__label--author" : "bf-comment__label");
      label.textContent = annotation.author ? "@" + annotation.author : "Review";
      head.appendChild(label);
      head.appendChild(el("span", "bf-comment__spacer"));
      if (isMine(annotation)) {
        var actions = el("div", "bf-comment__actions");
        var edit = el("button"); edit.type = "button"; edit.className = "bf-btn"; edit.textContent = "Edit";
        edit.addEventListener("click", function () { startEdit(card, index); });
        var remove = el("button"); remove.type = "button"; remove.className = "bf-btn"; remove.textContent = "Delete";
        remove.addEventListener("click", function () { removeComment(index); });
        actions.appendChild(edit); actions.appendChild(remove); head.appendChild(actions);
      }
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
`;
