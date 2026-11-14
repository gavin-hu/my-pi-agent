/**
 * The block half of the plan review's Markdown: tables, fenced code, headings, quotes,
 * and lists.
 *
 * It is a fragment of the same IIFE `web-client.ts` ships (`WEB_MARKDOWN_JS` is
 * interpolated into `REVIEW_CLIENT_JS`), kept in its own module so the client's
 * event wiring and its document rendering are read one at a time. The text inside a
 * block is rendered by `renderInline`, which crosses from `lib/web/markdown.ts` with
 * the board's card notes — one inline grammar and one link policy for both pages.
 *
 * Every value it writes is a DOM text node: plan and comment text never becomes markup,
 * and the only HTML it copies is the server's own `tok-*` spans.
 */

export const WEB_MARKDOWN_JS = String.raw`  // Copy only text and tok-* spans out of server-highlighted HTML, so a code
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
    var pre = el("pre");
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
    var table = el("table");
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
    var frame = el("div", "md-table-frame");
    var scroll = el("div", "md-table-wrap");
    scroll.appendChild(table);
    frame.appendChild(scroll);
    wrap.appendChild(frame);
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
      // The kit draws the list: one ul or ol, an li per item, the marker its own, and a task's box
      // the kit's drawn checkbox. The plan keeps only what a plan knows and the kit cannot — how
      // deep an item sits, and which of its steps the file has ticked.
      var items = [];
      var list = null;
      lines.forEach(function (line) {
        var match = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
        if (!match) {
          // A following unmarked line is a CommonMark lazy continuation of the
          // item above; join it so the paragraph hangs under the item's text.
          var last = items[items.length - 1];
          if (last) { if (line.trim()) last.rest += " " + line.trim(); return; }
          var plain = el("p"); renderInline(plain, line); wrap.appendChild(plain); return;
        }
        if (!list) {
          list = el(/^\d/.test(match[2]) ? "ol" : "ul");
          wrap.appendChild(list);
        }
        var row = el("li");
        row.style.marginLeft = String(Math.floor(match[1].replace(/\t/g, "    ").length / 2) * 16) + "px";
        var rest = match[3];
        var box = /^\[([ xX])\]\s*(.*)$/.exec(rest);
        if (box) {
          var done = box[1].toLowerCase() === "x";
          row.className = done ? "task done" : "task";
          var check = el("input", "md-check");
          check.type = "checkbox";
          check.setAttribute("disabled", "");
          if (done) check.setAttribute("checked", "");
          row.appendChild(check);
          rest = box[2];
        }
        var body = el("span");
        row.appendChild(body); list.appendChild(row);
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
