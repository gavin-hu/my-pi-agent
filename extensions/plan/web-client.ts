/**
 * The browser review client, served as `/client.js`.
 *
 * Kept as one self-contained script (like `file-browse/client.ts`) with no
 * build step. It renders the plan from the JSON data island using DOM text
 * nodes only — plan and comment text never becomes markup — renders each block
 * with its comment threads indented directly beneath it, highlights code by
 * copying only `tok-*` spans through `DOMParser`, builds the section outline
 * and review facts, and saves the annotation list back to the server. An
 * `EventSource` keeps a connection open so the server can tell when the tab is
 * gone; the explicit buttons are the primary save/cancel path.
 */

import { THEME_TOGGLE_JS } from "../../lib/web/index.ts";

export const REVIEW_CLIENT_JS = String.raw`(function () {
  "use strict";

  var dataNode = document.getElementById("review-data");
  var fallback = { blocks: [], annotations: [], outline: [], code: {}, token: "" };
  var data = fallback;
  if (dataNode && dataNode.textContent) {
    try { data = JSON.parse(dataNode.textContent); } catch (error) { data = fallback; }
  }
  var token = typeof data.token === "string" ? data.token : "";
  var annotations = Array.isArray(data.annotations) ? data.annotations.slice() : [];
  var saved = false;
  var closed = false;
  var connected = null;
  var everConnected = false;
  var dirty = false;
  var sectionObserver = null;
  var pendingQuote = null;
  var activeIndex = -1;
  var outlineItems = {};

  var planEl = document.getElementById("plan");
  var statusEl = document.getElementById("status");
  var stateEl = document.getElementById("review-state");
  var saveButton = document.getElementById("save");
  var cancelButton = document.getElementById("cancel");
  var outlineList = document.getElementById("outline-list");
  var progressEl = document.getElementById("progress-fill");
  var keysDialog = document.getElementById("keys-dialog");

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function setStatus(text, kind) {
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
    if (saved) {
      label = "Saved";
      tone = "success";
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
    if (dirty && !saved) {
      label += " \u00b7 unsaved";
      if (!tone) tone = "warn";
    }
    stateEl.textContent = label;
    stateEl.className = "bf-chip bf-chip--accent review-state" + (tone ? " bf-chip--" + tone : "");
  }

  function safeHref(url) {
    var trimmed = String(url).trim();
    if (/^[\\/]{2}/.test(trimmed)) return null;
    if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
    return trimmed;
  }

  // Inline token order matters: code, emphasis, and links are matched before a
  // bare URL, so a URL inside a link target or a code span is never re-split.
  var INLINE = /(\x60[^\x60]+\x60|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\)|(?:https?:\/\/|www\.)[^\s<]+)/g;

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
      // GFM extended autolink: a bare http(s) or www. URL in running text.
      if ((match = /^(?:https?:\/\/|www\.)[^\s<]+$/.exec(part))) {
        var url = match[0].replace(/[.,;:!?*_~]+$/, "");
        while (url.charAt(url.length - 1) === ")" && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) {
          url = url.slice(0, -1).replace(/[.,;:!?*_~]+$/, "");
        }
        var dot = url.indexOf(".");
        var target = /^www\./i.test(url) ? "http://" + url : url;
        var safe = dot > 0 && /\.[^./]/.test(url.slice(dot)) ? safeHref(target) : null;
        if (safe) {
          var auto = el("a");
          auto.textContent = url;
          auto.href = safe;
          auto.target = "_blank";
          auto.rel = "noreferrer noopener";
          container.appendChild(auto);
          return;
        }
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
    var pre = el("pre", "bf-code");
    var code = el("code");
    if (Array.isArray(highlighted)) {
      body.forEach(function (line, index) {
        var span = el("span", "bf-code__line");
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

  // A GFM table: split each pipe row into cells and honour the alignment row.
  function splitRow(line) {
    var text = String(line).trim();
    if (text.charAt(0) === "|") text = text.slice(1);
    if (text.charAt(text.length - 1) === "|") text = text.slice(0, -1);
    return text.split("|").map(function (cell) { return cell.trim(); });
  }

  function columnAlign(delim) {
    return splitRow(delim).map(function (cell) {
      var left = cell.charAt(0) === ":";
      var right = cell.charAt(cell.length - 1) === ":";
      return left && right ? "center" : right ? "right" : left ? "left" : "";
    });
  }

  function renderTable(wrap, block) {
    var rows = block.lines.map(splitRow);
    var align = columnAlign(block.lines[1] || "");
    var table = el("table", "review-table");
    var thead = el("thead");
    var headRow = el("tr");
    rows[0].forEach(function (cell, index) {
      var th = el("th");
      if (align[index]) th.style.textAlign = align[index];
      renderInline(th, cell);
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = el("tbody");
    rows.slice(2).forEach(function (cells) {
      var tr = el("tr");
      rows[0].forEach(function (unused, index) {
        var td = el("td");
        if (align[index]) td.style.textAlign = align[index];
        renderInline(td, cells[index] || "");
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    var scroll = el("div", "review-table-wrap");
    scroll.appendChild(table);
    wrap.appendChild(scroll);
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
    if (block.kind === "table") { renderTable(wrap, block); return; }
    if (block.kind === "hr") { wrap.appendChild(el("hr")); return; }
    if (block.kind === "quote") {
      var quote = el("blockquote");
      renderInline(quote, lines.map(function (line) { return line.replace(/^\s*>\s?/, ""); }).join("\n"));
      wrap.appendChild(quote);
      return;
    }
    if (block.kind === "list") {
      var items = [];
      lines.forEach(function (line) {
        var match = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
        if (!match) {
          // A following unmarked line is a CommonMark lazy continuation of the
          // item above; join it so the paragraph hangs under the item's text.
          var last = items[items.length - 1];
          if (last) { if (line.trim()) last.rest += " " + line.trim(); return; }
          var plain = el("p"); renderInline(plain, line); wrap.appendChild(plain); return;
        }
        var row = el("div", "bf-block__li");
        row.style.paddingLeft = String(Math.floor(match[1].replace(/\t/g, "    ").length / 2) * 16) + "px";
        var markerText = match[2];
        var rest = match[3];
        var box = /^\[([ xX])\]\s*(.*)$/.exec(rest);
        var marker = el("span", "marker");
        if (box) {
          var done = box[1].toLowerCase() === "x";
          markerText = done ? "\u2713" : "\u2610";
          marker.className = done ? "bf-block__marker bf-block__marker--done" : "bf-block__marker";
          rest = box[2];
        }
        marker.textContent = markerText;
        var body = el("span");
        row.appendChild(marker); row.appendChild(body); wrap.appendChild(row);
        items.push({ body: body, rest: rest });
      });
      // Render each body once, after its continuation lines are collected.
      items.forEach(function (item) { renderInline(item.body, item.rest); });
      return;
    }
    var paragraph = el("p");
    renderInline(paragraph, lines.join(" "));
    wrap.appendChild(paragraph);
  }

  function closeComposer() {
    var open = planEl ? planEl.querySelector(".bf-composer") : null;
    if (open && open.parentNode) open.parentNode.removeChild(open);
    Array.prototype.forEach.call(planEl ? planEl.querySelectorAll(".bf-block--composing") : [], function (block) {
      block.classList.remove("bf-block--composing");
    });
  }

  function selectionIn(wrap) {
    var selection = window.getSelection && window.getSelection();
    if (!selection || selection.isCollapsed) return "";
    var range = selection.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !wrap.contains(range.commonAncestorContainer)) return "";
    return selection.toString().replace(/\s+/g, " ").trim().slice(0, 500);
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
      if (event.key !== "Enter" || event.shiftKey) return;
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
    composer.appendChild(area);
    var row = el("div", "bf-composer__row");
    var cancel = el("button"); cancel.type = "button"; cancel.className = "bf-btn"; cancel.textContent = "Cancel";
    cancel.addEventListener("click", closeComposer);
    var add = el("button"); add.type = "button"; add.className = "bf-btn bf-btn--primary"; add.textContent = "Add comment";
    var submit = function () {
      var comment = area.value.replace(/\s+/g, " ").trim();
      if (!comment) { area.focus(); return; }
      if (annotations.length >= 200) { setStatus("Comment limit reached (200).", "error"); return; }
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
      remove.addEventListener("click", function () { annotations.splice(index, 1); dirty = true; renderPlan(); });
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
    var items = Array.isArray(data.blocks) ? data.blocks : [];
    var done = 0;
    var total = 0;
    items.forEach(function (block) {
      if (block.kind !== "list") return;
      (block.lines || []).forEach(function (line) {
        var box = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]/.exec(line);
        if (!box) return;
        total += 1;
        if (box[1].toLowerCase() === "x") done += 1;
      });
    });
    var stepFill = document.getElementById("step-fill");
    if (stepFill) stepFill.style.width = (total > 0 ? Math.round((done / total) * 100) : 0) + "%";
    var stepCount = document.getElementById("step-count");
    if (stepCount) stepCount.textContent = done + "/" + total;
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
    renderFacts();
    observeSections();
    updateState();
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
    if (saveButton) saveButton.disabled = true;
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

  function save() {
    if (saved) return;
    setStatus("Saving\u2026");
    fetch("/api/feedback?token=" + encodeURIComponent(token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ annotations: annotations })
    }).then(function (response) {
      if (response.ok) {
        saved = true;
        dirty = false;
        setStatus("Saved \u2014 return to Pi to continue.", "saved");
        lockActions();
        updateState();
        return;
      }
      if (response.status === 409) {
        setStatus("The plan changed on disk \u2014 reload to review again.", "error");
        if (saveButton) saveButton.disabled = true;
        offerReload();
        return;
      }
      throw new Error("server returned " + response.status);
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

  // Remember a selection made inside a block so clicking the rail button can
  // still quote it after the button press has collapsed the selection.
  document.addEventListener("mouseup", function (event) {
    if (!planEl || saved) return;
    var wrap = event.target && event.target.closest ? event.target.closest(".bf-block") : null;
    var quote = wrap && !wrap.querySelector(".bf-composer") ? selectionIn(wrap) : "";
    pendingQuote = wrap && quote ? { wrap: wrap, quote: quote } : null;
  });

  function toggleKeys(force) {
    if (!keysDialog) return;
    var open = force !== undefined ? force : keysDialog.hidden;
    keysDialog.hidden = !open;
    if (open) {
      var close = document.getElementById("keys-close");
      if (close) close.focus();
    }
  }

  if (keysDialog) {
    keysDialog.addEventListener("click", function (event) { if (event.target === keysDialog) toggleKeys(false); });
    var keysButton = document.getElementById("shortcuts");
    if (keysButton) keysButton.addEventListener("click", function () { toggleKeys(); });
    var keysClose = document.getElementById("keys-close");
    if (keysClose) keysClose.addEventListener("click", function () { toggleKeys(false); });
  }

  function typing(target) {
    var tag = target && target.tagName ? target.tagName : "";
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (target && target.isContentEditable);
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") { closeComposer(); toggleKeys(false); return; }
    if (typing(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "?") { event.preventDefault(); toggleKeys(); return; }
    // While the shortcut sheet is open it owns the keyboard.
    if (keysDialog && !keysDialog.hidden) return;
    if (event.key === "j") { event.preventDefault(); moveActive(1); return; }
    if (event.key === "k") { event.preventDefault(); moveActive(-1); return; }
    if (event.key === "c") { event.preventDefault(); commentOnActive(); return; }
    if (event.key === "s") { event.preventDefault(); save(); return; }
  });

  window.addEventListener("beforeunload", function () {
    if (saved || closed) return;
    var url = "/api/cancel?token=" + encodeURIComponent(token);
    if (navigator.sendBeacon) navigator.sendBeacon(url);
  });

  window.addEventListener("scroll", updateProgress);
  window.addEventListener("resize", updateProgress);
  if (planEl) planEl.addEventListener("scroll", updateProgress);

  try {
    var stream = new EventSource("/events?token=" + encodeURIComponent(token));
    stream.addEventListener("open", function () { connected = true; everConnected = true; updateState(); });
    stream.addEventListener("error", function () {
      // The server ends the stream on save; keep showing Saved rather than Offline.
      if (!saved) { connected = false; updateState(); }
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
