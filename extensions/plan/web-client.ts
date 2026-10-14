/**
 * The browser review client, served as `/client.js`.
 *
 * Kept as one self-contained script (like `file-browse/client.ts`) with no
 * build step. It renders the plan blocks from the JSON data island using DOM
 * text nodes only — plan and comment text never becomes markup — captures a
 * selection as a comment quote, and saves the annotation list back to the
 * server. An `EventSource` keeps a connection open so the server can tell when
 * the tab is gone; the explicit buttons are the primary save/cancel path.
 */

export const REVIEW_CLIENT_JS = String.raw`(function () {
  "use strict";

  var dataNode = document.getElementById("review-data");
  var fallback = { blocks: [], annotations: [], steps: { done: 0, total: 0 }, token: "" };
  var data = fallback;
  if (dataNode && dataNode.textContent) {
    try { data = JSON.parse(dataNode.textContent); } catch (error) { data = fallback; }
  }
  var token = typeof data.token === "string" ? data.token : "";
  var annotations = Array.isArray(data.annotations) ? data.annotations.slice() : [];
  var saved = false;
  var closed = false;

  var planEl = document.getElementById("plan");
  var statusEl = document.getElementById("status");
  var saveButton = document.getElementById("save");
  var cancelButton = document.getElementById("cancel");

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function setStatus(text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.className = kind ? "status " + kind : "status";
  }

  function safeHref(url) {
    var trimmed = String(url).trim();
    if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
    return trimmed;
  }

  var INLINE = /(\x60[^\x60]+\x60|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;

  function renderInline(container, text) {
    String(text).split(INLINE).forEach(function (part) {
      if (!part) return;
      var match;
      if ((match = /^\x60([^\x60]+)\x60$/.exec(part))) {
        var code = el("code"); code.textContent = match[1]; container.appendChild(code); return;
      }
      if ((match = /^\*\*([^*]+)\*\*$/.exec(part))) {
        var strong = el("strong"); strong.textContent = match[1]; container.appendChild(strong); return;
      }
      if ((match = /^\*([^*]+)\*$/.exec(part))) {
        var em = el("em"); em.textContent = match[1]; container.appendChild(em); return;
      }
      if ((match = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part))) {
        var href = safeHref(match[2]);
        if (!href) { container.appendChild(document.createTextNode(part)); return; }
        var link = el("a"); link.textContent = match[1]; link.href = href; link.target = "_blank"; link.rel = "noreferrer noopener";
        container.appendChild(link); return;
      }
      container.appendChild(document.createTextNode(part));
    });
  }

  function renderBlockContent(wrap, block) {
    var lines = Array.isArray(block.lines) ? block.lines : [];
    if (block.kind === "heading") {
      var text = lines.join(" ").replace(/^\s*#{1,6}\s*/, "");
      var level = Math.min(6, Math.max(1, (lines[0].match(/^ {0,3}(#{1,6})/) || ["", "#"])[1].length));
      var heading = el("h" + level);
      renderInline(heading, text);
      wrap.appendChild(heading);
      return;
    }
    if (block.kind === "code") {
      var body = lines.slice();
      if (body.length && /^ {0,3}(\x60{3,}|~{3,})/.test(body[0])) body.shift();
      if (body.length && /^ {0,3}(\x60{3,}|~{3,})/.test(body[body.length - 1])) body.pop();
      var pre = el("pre"); var code = el("code"); code.textContent = body.join("\n");
      pre.appendChild(code); wrap.appendChild(pre);
      return;
    }
    if (block.kind === "quote") {
      var quote = el("blockquote");
      renderInline(quote, lines.map(function (line) { return line.replace(/^\s*>\s?/, ""); }).join("\n"));
      wrap.appendChild(quote);
      return;
    }
    if (block.kind === "list") {
      lines.forEach(function (line) {
        var match = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
        if (!match) {
          var plain = el("p"); renderInline(plain, line); wrap.appendChild(plain); return;
        }
        var row = el("div", "li");
        row.style.paddingLeft = String(Math.floor(match[1].replace(/\t/g, "    ").length / 2) * 16) + "px";
        var markerText = match[2];
        var rest = match[3];
        var box = /^\[([ xX])\]\s*(.*)$/.exec(rest);
        if (box) { markerText = box[1].toLowerCase() === "x" ? "[x]" : "[ ]"; rest = box[2]; }
        var marker = el("span", "marker"); marker.textContent = markerText;
        var body2 = el("span"); renderInline(body2, rest);
        row.appendChild(marker); row.appendChild(body2); wrap.appendChild(row);
      });
      return;
    }
    var paragraph = el("p");
    renderInline(paragraph, lines.join(" "));
    wrap.appendChild(paragraph);
  }

  function closeComposer() {
    var open = planEl ? planEl.querySelector(".composer") : null;
    if (open && open.parentNode) open.parentNode.removeChild(open);
  }

  function selectionIn(wrap) {
    var selection = window.getSelection && window.getSelection();
    if (!selection || selection.isCollapsed) return "";
    var range = selection.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !wrap.contains(range.commonAncestorContainer)) return "";
    return selection.toString().replace(/\s+/g, " ").trim().slice(0, 500);
  }

  function openComposer(wrap, block, quote) {
    closeComposer();
    var box = el("div", "composer");
    if (quote) {
      var chip = el("div", "quote-chip");
      chip.textContent = "\u201c" + quote + "\u201d";
      box.appendChild(chip);
    }
    var area = el("textarea");
    area.placeholder = "Comment on this part of the plan";
    box.appendChild(area);
    var row = el("div", "row");
    var cancel = el("button"); cancel.type = "button"; cancel.textContent = "Cancel";
    cancel.addEventListener("click", closeComposer);
    var add = el("button"); add.type = "button"; add.className = "primary"; add.textContent = "Add comment";
    add.addEventListener("click", function () {
      var comment = area.value.replace(/\s+/g, " ").trim();
      if (!comment) { area.focus(); return; }
      annotations.push(quote ? { anchor: block.start, quote: quote, comment: comment } : { anchor: block.start, comment: comment });
      renderPlan();
    });
    row.appendChild(cancel); row.appendChild(add); box.appendChild(row);
    wrap.appendChild(box);
    area.focus();
  }

  function startEdit(card, index) {
    var annotation = annotations[index];
    card.textContent = "";
    var area = el("textarea");
    area.value = annotation.comment;
    card.appendChild(area);
    var row = el("div", "row");
    var cancel = el("button"); cancel.type = "button"; cancel.textContent = "Cancel";
    cancel.addEventListener("click", renderPlan);
    var apply = el("button"); apply.type = "button"; apply.className = "primary"; apply.textContent = "Save";
    apply.addEventListener("click", function () {
      var comment = area.value.replace(/\s+/g, " ").trim();
      if (!comment) { area.focus(); return; }
      annotation.comment = comment;
      renderPlan();
    });
    row.appendChild(cancel); row.appendChild(apply); card.appendChild(row);
    area.focus();
  }

  function renderCommentCards(box, list) {
    list.forEach(function (annotation) {
      var index = annotations.indexOf(annotation);
      var card = el("div", "comment");
      if (annotation.quote) {
        var quote = el("div", "quote");
        quote.textContent = "\u201c" + annotation.quote + "\u201d";
        card.appendChild(quote);
      }
      var body = el("div", "body");
      body.textContent = annotation.comment;
      card.appendChild(body);
      var row = el("div", "row");
      var edit = el("button"); edit.type = "button"; edit.textContent = "Edit";
      edit.addEventListener("click", function () { startEdit(card, index); });
      var remove = el("button"); remove.type = "button"; remove.textContent = "Delete";
      remove.addEventListener("click", function () { annotations.splice(index, 1); renderPlan(); });
      row.appendChild(edit); row.appendChild(remove); card.appendChild(row);
      box.appendChild(card);
    });
  }

  function renderComments(wrap, anchor) {
    var mine = annotations.filter(function (annotation) { return annotation.anchor === anchor; });
    if (mine.length === 0) return;
    var box = el("div", "comments");
    renderCommentCards(box, mine);
    wrap.appendChild(box);
  }

  function renderPlan() {
    if (!planEl) return;
    closeComposer();
    planEl.replaceChildren();
    var blocks = Array.isArray(data.blocks) ? data.blocks : [];
    var anchored = {};
    blocks.forEach(function (block) {
      if (block.kind === "blank") return;
      anchored[block.start] = true;
      var wrap = el("div", "block");
      wrap.setAttribute("data-line", String(block.start));
      wrap.setAttribute("data-kind", String(block.kind));
      renderBlockContent(wrap, block);
      var add = el("button", "add"); add.type = "button"; add.textContent = "+ Comment";
      add.addEventListener("click", function () { openComposer(wrap, block, selectionIn(wrap)); });
      wrap.appendChild(add);
      renderComments(wrap, block.start);
      planEl.appendChild(wrap);
    });
    var orphans = annotations.filter(function (annotation) { return !anchored[annotation.anchor]; });
    if (orphans.length > 0) {
      var wrap2 = el("div", "block");
      var note = el("p"); note.textContent = "Comments not attached to a current block:";
      wrap2.appendChild(note);
      var box = el("div", "comments");
      renderCommentCards(box, orphans);
      wrap2.appendChild(box);
      planEl.appendChild(wrap2);
    }
  }

  function renderHeader() {
    var titleEl = document.getElementById("plan-title");
    var pathEl = document.getElementById("plan-path");
    var progressEl = document.getElementById("step-progress");
    if (titleEl && data.title) titleEl.textContent = data.title;
    if (pathEl && data.relativePath) pathEl.textContent = data.relativePath;
    var steps = data.steps || {};
    if (progressEl && steps.total) progressEl.textContent = steps.done + "/" + steps.total + " steps done";
    if (data.title) document.title = "Plan review \u00b7 " + data.title;
  }

  function lockActions() {
    if (saveButton) saveButton.disabled = true;
    if (cancelButton) cancelButton.disabled = true;
  }

  function save() {
    if (saved) return;
    setStatus("Saving\u2026");
    fetch("/api/feedback?token=" + encodeURIComponent(token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ annotations: annotations })
    }).then(function (response) {
      if (!response.ok) throw new Error("server returned " + response.status);
      saved = true;
      setStatus("Saved \u2014 return to Pi to continue.", "saved");
      lockActions();
    }).catch(function (error) {
      setStatus("Could not save: " + error.message);
    });
  }

  function cancel() {
    if (saved || closed) return;
    closed = true;
    lockActions();
    setStatus("Closing\u2026");
    fetch("/api/cancel?token=" + encodeURIComponent(token), { method: "POST" }).catch(function () {}).then(function () {
      setStatus("Closed without saving.");
    });
  }

  if (saveButton) saveButton.addEventListener("click", save);
  if (cancelButton) cancelButton.addEventListener("click", cancel);

  document.addEventListener("mouseup", function (event) {
    if (!planEl || saved) return;
    var wrap = event.target && event.target.closest ? event.target.closest(".block") : null;
    if (!wrap || wrap.querySelector(".composer")) return;
    var quote = selectionIn(wrap);
    if (quote) openComposer(wrap, { start: Number(wrap.getAttribute("data-line")), lines: [] }, quote);
  });

  window.addEventListener("beforeunload", function () {
    if (saved || closed) return;
    var url = "/api/cancel?token=" + encodeURIComponent(token);
    if (navigator.sendBeacon) navigator.sendBeacon(url);
  });

  try {
    new EventSource("/events?token=" + encodeURIComponent(token));
  } catch (error) {
    // The server still sees the POST; the stream is only for close detection.
  }

  renderHeader();
  renderPlan();
})();
`;
