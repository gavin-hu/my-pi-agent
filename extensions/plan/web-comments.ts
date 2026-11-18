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
    // The line it belongs to, so a filtered view can hide the thread with its block.
    box.setAttribute("data-line", wrap.getAttribute("data-line") || "");
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

  /**
   * The open composer's block line, text, and the selection it quotes, or null when
   * nothing is being typed. The quote is half of what the comment will say, so a
   * draft that keeps the text and drops the quote would restore a different note.
   */
  function typingOf() {
    // Only the composer is "typing": an edit's text already lives in this tab's annotations,
    // which the draft keeps as this writer's own. Reading the edit here would restore it as a
    // second, empty comment after a reload and leave the edited card beside it.
    var area = planEl ? planEl.querySelector(".bf-composer textarea") : null;
    // The composer hangs under its block's thread box, and that box is what carries the
    // line: the block itself is the box's previous sibling.
    var box = area && area.closest ? area.closest(".bf-comments") : null;
    var anchor = box ? Number(box.getAttribute("data-line")) : -1;
    if (!area || !(anchor >= 0) || area.value === "") return null;
    var composer = area.closest ? area.closest(".bf-composer") : null;
    return { anchor: anchor, text: area.value, quote: (composer && composer.getAttribute("data-quote")) || "" };
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
    var stored = draft && draft.typing && typeof draft.typing.text === "string" ? draft.typing : null;
    // Rebuilt field by field: storage is hand-editable, and a chip rendered from a
    // non-string quote would read as [object Object].
    var typing =
      stored && typeof stored.anchor === "number"
        ? { anchor: stored.anchor, text: stored.text, quote: typeof stored.quote === "string" ? stored.quote : "" }
        : null;
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

  // The card's own actions repaint too, so they run the guard the ways off the page run: a
  // resolve, a delete, an undo, or a second editor over a comment being written refuses and
  // leaves the text where it is. The open editor's own Save and Cancel are the explicit ends
  // of the draft, so they call neither.
  function refuseOverDraft() {
    return guardDraft(planEl, statusEl, DRAFT_REFUSAL, paintStatus);
  }

  // A write asks the frame to focus the card it changed; the renderer consumes it once.
  function requestFocusOn(annotation) {
    var mine = annotations.filter(function (a) { return a.anchor === annotation.anchor; });
    requestFocus(annotation.anchor, mine.indexOf(annotation));
  }

  function openComposer(wrap, block, quote, initial) {
    // One composer at a time, and the open one holds text the page has not committed:
    // replacing it would drop that text without a word. A restored draft passes its text
    // as the initial value, because it is the thing being reopened, not a draft to protect.
    if (!initial && refuseOverDraft()) return;
    closeOpenComposer();
    wrap.classList.add("bf-block--composing");
    var composer = el("div", "bf-composer");
    if (quote) {
      var chip = el("div", "bf-quote-chip");
      chip.textContent = "\u201c" + quote + "\u201d";
      composer.appendChild(chip);
      // The chip is the quote's only record; the draft reads it back from here.
      composer.setAttribute("data-quote", quote);
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
    cancel.addEventListener("click", closeOpenComposer);
    var add = el("button"); add.type = "button"; add.className = "bf-btn bf-btn--primary"; add.textContent = "Add comment";
    var submit = function () {
      // A settled review takes no new comment: the note could never reach the plan, so
      // adding it would report "Comment added" about something nobody will read.
      if (saved || approved || closed) { setStatus("This review has ended; the comment was not added.", "error"); return; }
      if (role === "reviewer" && !reviewerName) { askName(); return; }
      var comment = area.value.replace(/\s+/g, " ").trim();
      if (!comment) { area.focus(); return; }
      if (annotations.length >= limits.comments) { setStatus("Comment limit reached (" + limits.comments + ").", "error"); return; }
        var entry = quote ? { anchor: block.start, quote: quote, comment: comment } : { anchor: block.start, comment: comment };
      if (role === "reviewer") entry.author = reviewerName;
      annotations.push(entry);
      // The repaint closes the composer; the frame's hint is what puts the tab stop on the
      // new card rather than on the block's control.
      requestFocusOn(entry);
      markDirty();
      setStatus("Comment added.");
      renderAll();
    };
    add.addEventListener("click", submit);
    submitOnEnter(area, submit);
    row.appendChild(cancel); row.appendChild(add); composer.appendChild(row);
    commentsBoxAfter(wrap).appendChild(composer);
    area.focus();
    // A restored draft resumes where it left off, with the caret at its end.
    if (initial) area.setSelectionRange(area.value.length, area.value.length);
  }

  // The open card editor's cancel, so the keymap can peel it without knowing which card it
  // belongs to. A repaint replaces the editor; the handle is used only while an editor is
  // still on the page, so a stale one cannot put an older body back over text it kept.
  var openEdit = null;

  function closeOpenEdit() {
    var editing = planEl ? planEl.querySelector(".bf-comment textarea") : null;
    var handle = openEdit;
    openEdit = null;
    if (editing && handle) handle();
  }

  function startEdit(card, index) {
    if (refuseOverDraft()) return;
    var annotation = annotations[index];
    // The text this editor opened on: Cancel puts it back, and clearing the field keeps the
    // old text in the draft rather than resurrecting a comment with no body.
    var before = annotation.comment;
    // Escape and Cancel end the edit the same way; Save is the only path that keeps the text.
    var close = function () {
      annotation.comment = before;
      markDirty();
      openEdit = null;
      requestFocusOn(annotation);
      renderAll();
    };
    openEdit = close;
    card.textContent = "";
    var area = el("textarea", "bf-textarea");
    area.value = annotation.comment;
    area.setAttribute("aria-label", "Edit comment");
    area.maxLength = limits.comment;
    card.appendChild(area);
    // Every keystroke is the comment's new text and this tab's draft, so a reload or a
    // repaint that waits for the draft keeps what was typed instead of the old body.
    area.addEventListener("input", function () {
      annotation.comment = area.value.trim() === "" ? before : area.value;
      markDirty();
    });
    var row = el("div", "bf-comment__row");
    var cancel = el("button"); cancel.type = "button"; cancel.className = "bf-btn"; cancel.textContent = "Cancel";
    cancel.addEventListener("click", close);
    var apply = el("button"); apply.type = "button"; apply.className = "bf-btn bf-btn--primary"; apply.textContent = "Save";
    apply.addEventListener("click", function () {
      var comment = area.value.replace(/\s+/g, " ").trim();
      if (!comment) { area.focus(); return; }
      annotation.comment = comment;
      openEdit = null;
      markDirty();
      setStatus("Comment updated.");
      requestFocusOn(annotation);
      renderAll();
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
    var controls = document.querySelector(".review-actions");
    clearUndo();
    if (!controls) return;
    var button = el("button", "bf-btn");
    button.type = "button";
    button.id = "undo-delete";
    button.textContent = "Undo delete";
    button.addEventListener("click", function () {
      if (refuseOverDraft()) return;
      annotations.splice(Math.min(index, annotations.length), 0, annotation);
      markDirty();
      clearUndo();
      requestFocusOn(annotation);
      renderAll();
      setStatus("Comment restored.", "saved");
    });
    controls.appendChild(button);
    undo = { button: button, timer: window.setTimeout(clearUndo, 6000) };
  }

  function removeComment(index) {
    var annotation = annotations[index];
    if (!annotation) return;
    if (refuseOverDraft()) return;
    var anchor = annotation.anchor;
    var local = annotations.filter(function (a) { return a.anchor === anchor; }).indexOf(annotation);
    annotations.splice(index, 1);
    markDirty();
    // The deleted card's place is where the next one now sits; an empty thread falls back
    // to the block's control in the frame.
    requestFocus(anchor, local);
    renderAll();
    offerUndo(index, annotation);
    setStatus("Comment deleted.");
  }

  // A comment belongs to whoever wrote it: an untagged one is the owner's, a
  // tagged one is that reviewer's. Everyone else's is read-only on this page, and a
  // viewer's is read-only to everyone: the name in this browser's storage may match a
  // note's author, and that is not a claim to the note.
  function isMine(annotation) {
    if (role === "viewer") return false;
    if (role === "owner") return !annotation.author;
    return !!reviewerName && annotation.author === reviewerName;
  }

  function renderCommentCards(box, list) {
    list.forEach(function (annotation) {
      var index = annotations.indexOf(annotation);
      var card = el("div", annotation.resolved ? "bf-comment bf-comment--resolved" : "bf-comment");
      card.setAttribute("role", "listitem");
      // A write's focus lands here; the card joins no tab order of its own.
      card.setAttribute("tabindex", "-1");
      var head = el("div", "bf-comment__head");
      // Every card names a person: "Review" was a category, and on a reviewer's page it
      // could be anybody — including the reader.
      var label = el("span", "bf-comment__label");
      label.textContent = annotation.author ? "@" + annotation.author : role === "owner" ? "You" : "The owner";
      head.appendChild(label);
      if (annotation.moved) {
        // A refinement carried this note off the text it was written on: the placement is
        // this build's best guess, and saying so is the difference between the reviewer's
        // anchor and ours.
        var moved = el("span", "bf-comment__moved");
        moved.textContent = "moved";
        moved.title =
          "Written on an earlier revision. The block it was on changed, so it sits here now: check it still refers to the text below.";
        head.appendChild(moved);
      }
      if (annotation.resolved) {
        // Settled notes keep their body: a quote is not stored in the plan, so hiding the text
        // would leave a reloaded card with nothing to read, and the note is the record.
        var settled = el("span", "bf-comment__resolved");
        settled.textContent = "\u2713 settled";
        settled.title = "Settled: kept in the plan as the record of the question";
        head.appendChild(settled);
      }
      head.appendChild(el("span", "bf-comment__spacer"));
      if (isMine(annotation)) {
        var actions = el("div", "bf-comment__actions");
        var edit = el("button"); edit.type = "button"; edit.className = "bf-btn bf-btn--sm"; edit.textContent = "Edit";
        edit.addEventListener("click", function () { startEdit(card, index); });
        var settle = el("button"); settle.type = "button"; settle.className = "bf-btn bf-btn--sm";
        settle.textContent = annotation.resolved ? "Reopen" : "Resolve";
        settle.addEventListener("click", function () {
          if (refuseOverDraft()) return;
          if (annotation.resolved) delete annotation.resolved;
          else annotation.resolved = true;
          markDirty();
          requestFocusOn(annotation);
          renderAll();
          setStatus(annotation.resolved ? "Comment resolved." : "Comment reopened.");
        });
        var remove = el("button"); remove.type = "button"; remove.className = "bf-btn bf-btn--sm"; remove.textContent = "Delete";
        remove.addEventListener("click", function () { removeComment(index); });
        actions.appendChild(settle); actions.appendChild(edit); actions.appendChild(remove); head.appendChild(actions);
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

  function renderComments(container, anchor, label) {
    var mine = annotations.filter(function (annotation) { return annotation.anchor === anchor; });
    if (mine.length === 0) return;
    var box = el("div", "bf-comments");
    // The block this thread hangs under, as a line: the view filter hides the two together.
    box.setAttribute("data-line", String(anchor));
    box.setAttribute("role", "list");
    box.setAttribute(
      "aria-label",
      mine.length + (mine.length === 1 ? " comment" : " comments") + " on \u201c" + label + "\u201d"
    );
    renderCommentCards(box, mine);
    container.appendChild(box);
  }
`;
