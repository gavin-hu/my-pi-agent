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

  function renderCode(wrap, block) {
    var body = Array.isArray(block.body) ? block.body : [];
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

  // The table's cells and alignment came with the block: the scan split the row and read the
  // delimiter, so the page only draws what it was handed.
  function renderTable(wrap, block) {
    var rows = Array.isArray(block.cells) ? block.cells : [];
    var align = Array.isArray(block.align) ? block.align : [];
    var header = rows[0] || [];
    var table = el("table");
    var thead = el("thead");
    var headRow = el("tr");
    header.forEach(function (cell, index) {
      var th = el("th");
      if (align[index]) th.style.textAlign = align[index];
      renderInline(th, cell);
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = el("tbody");
    rows.slice(1).forEach(function (cells) {
      var tr = el("tr");
      header.forEach(function (unused, index) {
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

  // The list a run of items is being drawn into, owned by the frame that draws them: the scan
  // gives every item its own block (a comment points at a step), so grouping them is the page's.
  function renderBlockContent(wrap, block, list) {
    var lines = Array.isArray(block.lines) ? block.lines : [];
    // Nothing but an item continues a list: every other kind ends the run.
    if (block.kind !== "list") list.open = null;
    if (block.kind === "heading") {
      var level = Math.min(6, Math.max(1, Number(block.level) || 1));
      var heading = el("h" + level);
      renderInline(heading, String(block.text === undefined ? lines.join(" ") : block.text));
      wrap.appendChild(heading);
      return;
    }
    if (block.kind === "code") { renderCode(wrap, block); return; }
    if (block.kind === "table") { renderTable(wrap, block); return; }
    if (block.kind === "hr") { wrap.appendChild(el("hr")); return; }
    if (block.kind === "quote") {
      var quote = el("blockquote");
      var quoted = Array.isArray(block.quote) ? block.quote : lines;
      renderInline(quote, quoted.join("\n"));
      wrap.appendChild(quote);
      return;
    }
    if (block.kind === "list") {
      // One item, one <li>: the marker is the kit's, the box is the kit's drawn checkbox, and
      // the page keeps only the grouping and what a plan knows — how deep the item sits and
      // which of its steps the file has ticked.
      var item = block.item || {};
      var ordered = item.ordered === true;
      if (!list.open || list.ordered !== ordered) {
        // A change of marker kind starts a list of its own; the kit's rules draw both.
        list.open = el(ordered ? "ol" : "ul");
        list.ordered = ordered;
        wrap.appendChild(list.open);
      }
      var rest = String(item.content === undefined ? lines.join(" ") : item.content);
      // A continuation line is the item's own text, so it hangs under it rather than opening
      // a paragraph of its own.
      for (var n = 1; n < lines.length; n++) {
        if (String(lines[n]).trim()) rest += " " + String(lines[n]).trim();
      }
      var row = el("li");
      // Only a nested item states an indent: a top-level one leaves the marker where the kit
      // puts it, so a plain bullet's text and a task's own text keep the one left edge.
      var depth = Math.floor(Number(item.indent) / 2);
      if (depth > 0) row.style.marginLeft = String(depth * 16) + "px";
      if (item.task === "done" || item.task === "open") {
        var done = item.task === "done";
        row.className = done ? "task done" : "task";
        var check = el("input", "md-check");
        check.type = "checkbox";
        check.setAttribute("disabled", "");
        if (done) check.setAttribute("checked", "");
        row.appendChild(check);
      }
      renderInline(row, rest);
      list.open.appendChild(row);
      return;
    }
    var paragraph = el("p");
    renderInline(paragraph, lines.join(" "));
    wrap.appendChild(paragraph);
  }
`;
