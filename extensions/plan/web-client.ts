/**
 * The browser review client, served as `/client.js`.
 *
 * Kept as one self-contained script (like `file-browse/client.ts`) with no
 * build step. It renders the plan from the JSON data island using DOM text
 * nodes only — plan and comment text never becomes markup — pairs every block
 * with a right-hand rail cell so comments sit level with their block, renders
 * server-highlighted code by copying only `tok-*` spans through `DOMParser`,
 * builds the section outline, and saves the annotation list back to the
 * server. An `EventSource` keeps a connection open so the server can tell when
 * the tab is gone; the explicit buttons are the primary save/cancel path.
 */

import { THEME_TOGGLE_JS } from "../../lib/web-theme.ts";

export const REVIEW_CLIENT_JS = String.raw`(function () {
  "use strict";

  var dataNode = document.getElementById("review-data");
  var fallback = { blocks: [], annotations: [], steps: { done: 0, total: 0 }, outline: [], code: {}, token: "" };
  var data = fallback;
  if (dataNode && dataNode.textContent) {
    try { data = JSON.parse(dataNode.textContent); } catch (error) { data = fallback; }
  }
  var token = typeof data.token === "string" ? data.token : "";
  var annotations = Array.isArray(data.annotations) ? data.annotations.slice() : [];
  var saved = false;
  var closed = false;
  var sectionObserver = null;

  var planEl = document.getElementById("plan");
  var statusEl = document.getElementById("status");
  var saveButton = document.getElementById("save");
  var cancelButton = document.getElementById("cancel");
  var outlineList = document.getElementById("outline-list");
  var commentCount = document.getElementById("comment-count");
  var stepsEl = document.getElementById("steps");
  var stepsFill = document.getElementById("steps-fill");
  var stepsLabel = document.getElementById("steps-label");

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

  // Copy only text and tok-* spans out of server-highlighted HTML, so a code
  // line can never introduce markup even though it arrives as a string.
  function copyTokens(from, to) {
    Array.prototype.forEach.call(from.childNodes, function (node) {
      if (node.nodeType === 3) { to.appendChild(document.createTextNode(node.nodeValue)); return; }
      if (node.nodeType === 1 && node.tagName === "SPAN" && /^tok-/.test(node.className || "")) {
        var span = el("span", node.className);
        copyTokens(node, span);
        to.appendChild(span);
        return;
      }
      to.appendChild(document.createTextNode(node.textContent || ""));
    });
  }

  function codeBody(lines) {
    var body = Array.isArray(lines) ? lines.slice() : [];
    if (body.length && /^ {0,3}(\x60{3,}|~{3,})/.test(body[0])) body.shift();
    if (body.length && /^ {0,3}(\x60{3,}|~{3,})/.test(body[body.length - 1])) body.pop();
    return body;
  }

  function renderCode(wrap, block) {
    var body = codeBody(block.lines);
    var highlighted = data.code && data.code[String(block.start)];
    var pre = el("pre", "code");
    var code = el("code");
    if (Array.isArray(highlighted)) {
      body.forEach(function (line, index) {
        var span = el("span", "line");
        var html = highlighted[index];
        if (html) {
          try { copyTokens(new DOMParser().parseFromString(html, "text/html").body, span); }
          catch (error) { span.textContent = line; }
        } else {
          span.textContent = line;
        }
        code.appendChild(span);
        if (index < body.length - 1) code.appendChild(document.createTextNode("\n"));
      });
    } else {
      code.textContent = body.join("\n");
    }
    pre.appendChild(code);
    wrap.appendChild(pre);
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
    if (block.kind === "code") { renderCode(wrap, block); return; }
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
        var marker = el("span", "marker");
        if (box) {
          var done = box[1].toLowerCase() === "x";
          markerText = done ? "\u2713" : "\u2610";
          marker.className = done ? "marker done" : "marker";
          rest = box[2];
        }
        marker.textContent = markerText;
        var body = el("span"); renderInline(body, rest);
        row.appendChild(marker); row.appendChild(body); wrap.appendChild(row);
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
    Array.prototype.forEach.call(planEl ? planEl.querySelectorAll(".block.composing") : [], function (block) {
      block.classList.remove("composing");
    });
  }

  function selectionIn(wrap) {
    var selection = window.getSelection && window.getSelection();
    if (!selection || selection.isCollapsed) return "";
    var range = selection.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !wrap.contains(range.commonAncestorContainer)) return "";
    return selection.toString().replace(/\s+/g, " ").trim().slice(0, 500);
  }

  function openComposer(wrap, cell, block, quote) {
    closeComposer();
    wrap.classList.add("composing");
    var box = el("div", "composer");
    if (quote) {
      var chip = el("div", "quote-chip");
      chip.textContent = "\u201c" + quote + "\u201d";
      box.appendChild(chip);
    }
    var area = el("textarea");
    area.placeholder = "Leave feedback on this part of the plan";
    area.setAttribute("aria-label", "Comment");
    box.appendChild(area);
    var row = el("div", "row");
    var cancel = el("button"); cancel.type = "button"; cancel.className = "action"; cancel.textContent = "Cancel";
    cancel.addEventListener("click", closeComposer);
    var add = el("button"); add.type = "button"; add.className = "action primary"; add.textContent = "Add comment";
    add.addEventListener("click", function () {
      var comment = area.value.replace(/\s+/g, " ").trim();
      if (!comment) { area.focus(); return; }
      annotations.push(quote ? { anchor: block.start, quote: quote, comment: comment } : { anchor: block.start, comment: comment });
      renderPlan();
    });
    row.appendChild(cancel); row.appendChild(add); box.appendChild(row);
    cell.appendChild(box);
    area.focus();
  }

  function startEdit(card, index) {
    var annotation = annotations[index];
    card.textContent = "";
    var area = el("textarea");
    area.value = annotation.comment;
    area.setAttribute("aria-label", "Edit comment");
    card.appendChild(area);
    var row = el("div", "row");
    var cancel = el("button"); cancel.type = "button"; cancel.className = "action"; cancel.textContent = "Cancel";
    cancel.addEventListener("click", renderPlan);
    var apply = el("button"); apply.type = "button"; apply.className = "action primary"; apply.textContent = "Save";
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
      var edit = el("button"); edit.type = "button"; edit.className = "action"; edit.textContent = "Edit";
      edit.addEventListener("click", function () { startEdit(card, index); });
      var remove = el("button"); remove.type = "button"; remove.className = "action"; remove.textContent = "Delete";
      remove.addEventListener("click", function () { annotations.splice(index, 1); renderPlan(); });
      row.appendChild(edit); row.appendChild(remove); card.appendChild(row);
      box.appendChild(card);
    });
  }

  function renderComments(cell, anchor) {
    var mine = annotations.filter(function (annotation) { return annotation.anchor === anchor; });
    if (mine.length === 0) return;
    var box = el("div", "comments");
    renderCommentCards(box, mine);
    cell.appendChild(box);
  }

  function updateCount() {
    if (!commentCount) return;
    var count = annotations.length;
    commentCount.textContent = count === 0 ? "No comments yet \u2014 select text to comment" : count + (count === 1 ? " comment" : " comments");
  }

  function observeSections() {
    if (sectionObserver && sectionObserver.disconnect) sectionObserver.disconnect();
    sectionObserver = null;
    if (!outlineList || !window.IntersectionObserver) return;
    var links = {};
    Array.prototype.forEach.call(outlineList.querySelectorAll("a"), function (link) {
      links[link.getAttribute("data-id")] = link;
    });
    var headings = Array.prototype.slice.call(planEl.querySelectorAll(".block[id]"));
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
    }, { rootMargin: "-76px 0px -68% 0px", threshold: 0 });
    headings.forEach(function (heading) { sectionObserver.observe(heading); });
  }

  function renderOutline() {
    if (!outlineList) return;
    outlineList.replaceChildren();
    var items = Array.isArray(data.outline) ? data.outline : [];
    items.forEach(function (item) {
      var li = el("li", "lvl-" + item.level);
      var link = el("a");
      link.href = "#" + item.id;
      link.setAttribute("data-id", item.id);
      link.textContent = item.text;
      li.appendChild(link);
      outlineList.appendChild(li);
    });
    var panel = document.querySelector(".outline-panel");
    if (panel && items.length === 0) panel.hidden = true;
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
      if (block.kind === "heading") wrap.id = "s-" + block.start;
      renderBlockContent(wrap, block);
      var cell = el("div", "rail-cell");
      cell.setAttribute("data-line", String(block.start));
      var add = el("button", "add");
      add.type = "button";
      add.textContent = "+ Comment";
      add.setAttribute("aria-label", "Comment on this block");
      add.addEventListener("click", function () { openComposer(wrap, cell, block, selectionIn(wrap)); });
      wrap.appendChild(add);
      planEl.appendChild(wrap);
      planEl.appendChild(cell);
      renderComments(cell, block.start);
    });
    var orphans = annotations.filter(function (annotation) { return !anchored[annotation.anchor]; });
    if (orphans.length > 0) {
      var wrap2 = el("div", "block orphans");
      var note = el("p"); note.textContent = "Comments not attached to a current block";
      wrap2.appendChild(note);
      planEl.appendChild(wrap2);
      var cell2 = el("div", "rail-cell");
      var box = el("div", "comments");
      renderCommentCards(box, orphans);
      cell2.appendChild(box);
      planEl.appendChild(cell2);
    }
    updateCount();
    observeSections();
  }

  function renderHeader() {
    var titleEl = document.getElementById("plan-title");
    var pathEl = document.getElementById("plan-path");
    if (titleEl && data.title) titleEl.textContent = data.title;
    if (pathEl && data.relativePath) pathEl.textContent = data.relativePath;
    if (data.title) document.title = "Plan review \u00b7 " + data.title;
    var steps = data.steps || {};
    if (stepsEl && steps.total) {
      stepsEl.hidden = false;
      if (stepsFill) stepsFill.style.width = Math.round((steps.done / steps.total) * 100) + "%";
      if (stepsLabel) stepsLabel.textContent = steps.done + "/" + steps.total + " steps";
    }
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
      setStatus("Could not save: " + error.message, "error");
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
    var cell = wrap.nextElementSibling;
    if (!cell || !cell.classList.contains("rail-cell")) return;
    var quote = selectionIn(wrap);
    if (quote) openComposer(wrap, cell, { start: Number(wrap.getAttribute("data-line")), lines: [] }, quote);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeComposer();
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

  ${THEME_TOGGLE_JS}

  renderHeader();
  renderOutline();
  renderPlan();
})();
`;
