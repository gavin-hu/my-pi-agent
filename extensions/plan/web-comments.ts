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
      if (closed) { setStatus("The review is closed; this comment was not added.", "error"); return; }
      if (role === "reviewer" && !reviewerName) { askName(); return; }
      var comment = area.value.replace(/\s+/g, " ").trim();
      if (!comment) { area.focus(); return; }
      if (annotations.length >= limits.comments) { setStatus("Comment limit reached (" + limits.comments + ").", "error"); return; }
        var entry = quote ? { anchor: block.start, quote: quote, comment: comment } : { anchor: block.start, comment: comment };
      if (role === "reviewer") entry.author = reviewerName;
      annotations.push(entry);
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
