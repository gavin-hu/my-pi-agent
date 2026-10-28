/**
 * Inline Markdown, for every served page: one renderer and one link policy.
 *
 * Two pages read Markdown written by a model or a person — the plan review's document and
 * the board's card notes — and each needs the same two answers: what an inline token is,
 * and which target a link may point at. A second copy of either is how one page starts
 * accepting a `javascript:` target the other refuses, so the body lives here and each page
 * splices it into its own bundle.
 *
 * The renderer appends **text nodes and four elements only** — `code`, `strong`, `em`, and
 * `a` — so plan, comment, and note text never becomes markup and no page needs `innerHTML`.
 * A link is made only for a target `safeHref` allows: `http`, `https`, or `mailto`, no
 * credentials, and no protocol-relative or disguised relative target.
 *
 * It is the inline half only. A card note is one sanitized line, so inline is the whole of
 * it; the review page's blocks, tables, fenced code, and lists are its own half, and they
 * call `renderInline` for the text inside each.
 *
 * The body is JavaScript: no annotation survives into a string, and no backtick or `${`
 * may appear in one. `base` is the page's own URL at call time, which is what makes a
 * target that only looks relative land as text.
 */
export const INLINE_MARKDOWN_JS = String.raw`  // A link is rendered only for an http(s) or mailto target. Resolving against
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
  }`;
