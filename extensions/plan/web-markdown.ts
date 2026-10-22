/**
 * The Markdown half of the review client script.
 *
 * It is a fragment of the same IIFE `web-client.ts` ships (`WEB_MARKDOWN_JS` is
 * interpolated into `REVIEW_CLIENT_JS`), kept in its own module so the client's
 * event wiring and its document rendering are read one at a time. Every value it
 * writes is a DOM text node: plan and comment text never becomes markup, and the
 * only HTML it copies is the server's own `tok-*` spans.
 */

export const WEB_MARKDOWN_JS = String.raw`  // A link is rendered only for an http(s) or mailto target. Resolving against
  // the review origin is what catches a target that only looks relative: the
  // URL parser strips a tab or newline, so "/\t/evil.com" is cross-origin once
  // it is parsed, and a disguised target must stay text.
  function safeHref(url, base) {
    var trimmed = String(url).trim();
    if (!trimmed || /^\/\//.test(trimmed)) return null;
    var resolved;
    try { resolved = new URL(trimmed, base); } catch (error) { return null; }
    if (resolved.protocol === "mailto:") return trimmed;
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return null;
    if (resolved.username || resolved.password) return null;
    if (resolved.origin === new URL(base).origin) return resolved.href;
    return /^https?:\/\//i.test(trimmed) ? resolved.href : null;
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
        var href = safeHref(match[2], location.href);
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
        var safe = dot > 0 && /\.[^./]/.test(url.slice(dot)) ? safeHref(target, location.href) : null;
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
`;
