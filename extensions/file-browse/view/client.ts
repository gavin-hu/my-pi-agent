/**
 * The first-party browser script, served as `/app.js`.
 *
 * It is intentionally tiny and dependency-free: it only progressively enhances
 * what the server already rendered. The sidebar (filter, fold, lazy tree,
 * keyboard) is `tree.ts` and the quick-open palette is `palette.ts`; both are
 * fragments of this same IIFE, interpolated below. What stays here is the shell:
 * sorting, wrapping, copying, the diff's hunk navigation, the reading progress,
 * and the page's keymap. Navigation works without any of it.
 *
 * Kept as a string constant so the extension is a single self-contained module
 * and `bun build --no-bundle` needs no separate asset.
 */

import { keysDialogScript, THEME_TOGGLE_JS } from "../../../lib/web/index.ts";
import { LIVE_CLIENT_JS } from "./live-client.ts";
import { PALETTE_CLIENT_JS } from "./palette.ts";
import { TREE_CLIENT_JS } from "./tree.ts";

export const CLIENT_JS = `(function () {
	"use strict";
	var rows = Array.prototype.slice.call(document.querySelectorAll("table.bf-table tbody tr"));
${TREE_CLIENT_JS}
	Array.prototype.forEach.call(document.querySelectorAll("img.bf-table__thumb"), function (img) {
		img.addEventListener("error", function () {
			img.hidden = true;
			var fallback = img.parentElement && img.parentElement.querySelector(".browse-cat");
			if (fallback) fallback.hidden = false;
		});
	});

	var store = {
		get: function (key) {
			try { return window.localStorage.getItem(key); } catch (error) { return null; }
		},
		set: function (key, value) {
			try { window.localStorage.setItem(key, value); } catch (error) { /* private mode */ }
		}
	};

	// Shared theme toggle; the element contract is #theme-toggle / .theme-glyph.
	${THEME_TOGGLE_JS}

	var sortButtons = Array.prototype.slice.call(document.querySelectorAll("table.bf-table th .bf-sort"));

	function setSort(key, direction, remember) {
		sortButtons.forEach(function (button) {
			var th = button.closest("th");
			if (!th) return;
			if (button.getAttribute("data-sort") === key) th.setAttribute("aria-sort", direction);
			else th.removeAttribute("aria-sort");
		});
		rows.sort(function (a, b) {
			var dirA = a.getAttribute("data-dir") === "1" ? 0 : 1;
			var dirB = b.getAttribute("data-dir") === "1" ? 0 : 1;
			if (dirA !== dirB) return dirA - dirB;
			var result;
			if (key === "size" || key === "mtime") {
				result = Number(a.getAttribute("data-" + key)) - Number(b.getAttribute("data-" + key));
			} else {
				result = (a.getAttribute("data-name") || "")
					.toLowerCase()
					.localeCompare((b.getAttribute("data-name") || "").toLowerCase());
			}
			if (result === 0) result = (a.getAttribute("data-name") || "").localeCompare(b.getAttribute("data-name") || "");
			return direction === "descending" ? -result : result;
		});
		var tbody = rows.length > 0 ? rows[0].parentElement : null;
		if (tbody) rows.forEach(function (row) { tbody.appendChild(row); });
		if (remember) store.set("browse-sort", key + ":" + direction);
	}

	if (sortButtons.length > 0) {
		var savedSort = store.get("browse-sort");
		var savedParts = savedSort ? savedSort.split(":") : [];
		if (savedParts.length === 2) setSort(savedParts[0], savedParts[1] === "descending" ? "descending" : "ascending", false);
		sortButtons.forEach(function (button) {
			button.addEventListener("click", function () {
				var th = button.closest("th");
				var direction = th && th.getAttribute("aria-sort") === "ascending" ? "descending" : "ascending";
				setSort(button.getAttribute("data-sort") || "name", direction, true);
			});
		});
	}

	var wrapButton = document.getElementById("wrap-toggle");
	var code = document.querySelector("pre.bf-code");
	function applyWrap(on) {
		if (!code) return;
		if (on) code.classList.add("bf-code--wrap");
		else code.classList.remove("bf-code--wrap");
		if (wrapButton) {
			wrapButton.setAttribute("aria-pressed", on ? "true" : "false");
			wrapButton.textContent = on ? "no wrap" : "wrap";
		}
	}
	if (wrapButton && code) {
		var wrapOn = store.get("browse-wrap") === "1";
		applyWrap(wrapOn);
		wrapButton.addEventListener("click", function () {
			wrapOn = !code.classList.contains("bf-code--wrap");
			applyWrap(wrapOn);
			store.set("browse-wrap", wrapOn ? "1" : "0");
		});
	}

	function copyText(value) {
		if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(value);
		return new Promise(function (resolve, reject) {
			var area = document.createElement("textarea");
			area.value = value;
			area.setAttribute("readonly", "");
			area.style.position = "fixed";
			area.style.opacity = "0";
			document.body.appendChild(area);
			area.select();
			try { document.execCommand("copy"); resolve(); }
			catch (error) { reject(error); }
			finally { document.body.removeChild(area); }
		});
	}

	function flash(button, label, message) {
		var original = button.textContent;
		button.textContent = label;
		var status = document.getElementById("copy-status");
		if (status) status.textContent = message;
		window.setTimeout(function () { button.textContent = original; }, 1200);
	}

	Array.prototype.forEach.call(document.querySelectorAll("[data-copy]"), function (button) {
		button.addEventListener("click", function () {
			var source;
			if (button.getAttribute("data-copy") === "path") {
				source = Promise.resolve(button.getAttribute("data-value") || "");
			} else {
				source = fetch(button.getAttribute("data-href") || "").then(function (response) {
					if (!response.ok) throw new Error("copy failed");
					return response.text();
				});
			}
			source
				.then(function (text) { return copyText(text); })
				.then(function () { flash(button, "copied", "Copied to clipboard"); })
				.catch(function () { flash(button, "failed", "Copy failed"); });
		});
	});

${PALETTE_CLIENT_JS}

	// A code reference: the file's path and the lines the reader selected. A click on
	// the button collapses the selection before its click handler runs, so a new
	// selection replaces the stored one and a collapse leaves it alone.
	var reference = null;

	function lineNode(node) {
		var element = node && node.nodeType === 3 ? node.parentElement : node;
		return element && element.closest ? element.closest(".bf-code__line") : null;
	}

	function referenceText() {
		if (!reference || !reference.path) return "";
		var span = reference.start === reference.end ? String(reference.start) : reference.start + "-" + reference.end;
		return reference.path + ":" + span;
	}

	function captureReference() {
		var button = document.getElementById("copy-reference");
		if (!button) return;
		var selection = window.getSelection && window.getSelection();
		if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
		var range = selection.getRangeAt(0);
		var from = lineNode(range.startContainer);
		var to = lineNode(range.endContainer);
		if (!from || !to) return;
		var pre = from.closest("pre[data-path]");
		if (!pre || pre !== to.closest("pre[data-path]")) return;
		var lines = Array.prototype.slice.call(pre.querySelectorAll(".bf-code__line"));
		var first = lines.indexOf(from);
		var last = lines.indexOf(to);
		if (first < 0 || last < 0) return;
		reference = {
			path: pre.getAttribute("data-path") || "",
			start: Math.min(first, last) + 1,
			end: Math.max(first, last) + 1
		};
		button.disabled = false;
		button.title = "Copy " + referenceText();
	}

	function copyReference() {
		var text = referenceText();
		var button = document.getElementById("copy-reference");
		if (!text) {
			var status = document.getElementById("copy-status");
			if (status) status.textContent = "Select lines in the code to copy a reference.";
			return;
		}
		copyText(text)
			.then(function () { if (button) flash(button, "copied", "Copied " + text); })
			.catch(function () { if (button) flash(button, "failed", "Copy failed"); });
	}

	if (document.getElementById("copy-reference")) {
		document.getElementById("copy-reference").addEventListener("click", copyReference);
		document.addEventListener("mouseup", captureReference);
		document.addEventListener("keyup", captureReference);
	}

	// Keyboard: the shared shortcut sheet, the per-page actions the server
	// rendered, and hunk-to-hunk navigation through a diff.
	${keysDialogScript("keys-open")}
	var hunkAnchors = Array.prototype.slice.call(document.querySelectorAll("[data-hunk]"));
	var progressFill = document.getElementById("progress-fill");

	function toggleRaw() {
		var next = document.querySelector(".bf-card__actions .bf-segmented a.bf-segmented__item:not([aria-current])");
		if (next) window.location.assign(next.getAttribute("href") || next.href);
	}

	// The hunk whose header is pinned (or last passed), then one step either way.
	function moveHunk(delta) {
		if (hunkAnchors.length === 0) return;
		var scroller = primaryScroller();
		// The line a pinned hunk header sticks to: the code viewport's top inset
		// by its padding. With no scrolling pane (narrow screens) the page is the
		// viewport, so the anchor is the window top.
		var lineTop = 8;
		if (scroller) lineTop = scroller.getBoundingClientRect().top + (parseFloat(getComputedStyle(scroller).paddingTop) || 0);
		var current = -1;
		for (var index = 0; index < hunkAnchors.length; index++) {
			if (hunkAnchors[index].getBoundingClientRect().top <= lineTop + 2) current = index;
		}
		var next = Math.max(0, Math.min(hunkAnchors.length - 1, current + delta));
		if (scroller) scroller.scrollTop += hunkAnchors[next].getBoundingClientRect().top - lineTop;
		else hunkAnchors[next].scrollIntoView({ block: "start" });
	}

	// The page's primary scroller: the card body for a file or diff, the main
	// column otherwise.
	function primaryScroller() {
		var candidates = [
			document.getElementById("main"),
			document.querySelector(".bf-md"),
			document.querySelector("pre.bf-code")
		];
		var best = null;
		var bestRange = 0;
		candidates.forEach(function (node) {
			if (!node) return;
			var range = node.scrollHeight - node.clientHeight;
			if (range > bestRange) { bestRange = range; best = node; }
		});
		return bestRange > 0 ? best : null;
	}

	function updateProgress() {
		if (!progressFill) return;
		var scroller = primaryScroller();
		var doc = document.scrollingElement || document.documentElement;
		var top = doc ? doc.scrollTop : 0;
		var height = doc ? doc.scrollHeight : 0;
		var view = doc ? doc.clientHeight : 0;
		if (scroller) { top = scroller.scrollTop; height = scroller.scrollHeight; view = scroller.clientHeight; }
		var max = height - view;
		var percent = max > 0 ? Math.min(100, Math.max(0, (top / max) * 100)) : 0;
		progressFill.style.width = percent + "%";
	}

	// A table wider than the pane scrolls sideways, but an overlay scrollbar is
	// invisible until it moves; the class fades the frame's right edge while
	// columns are still out of view, and drops at the end so the last stays crisp.
	function markTableOverflow() {
		var frames = document.querySelectorAll(".md-table-frame");
		Array.prototype.forEach.call(frames, function (frame) {
			var wrap = frame.querySelector(".md-table-wrap");
			if (!wrap) return;
			var hidden = wrap.scrollWidth - wrap.clientWidth;
			frame.classList.toggle("browse-table-more", hidden > 1 && wrap.scrollLeft < hidden - 1);
		});
	}

	window.addEventListener("scroll", updateProgress, true);
	window.addEventListener("resize", updateProgress);
	updateProgress();
	window.addEventListener("resize", markTableOverflow);
	window.addEventListener("load", markTableOverflow);
	document.addEventListener("scroll", markTableOverflow, true);
	markTableOverflow();

	document.addEventListener("keydown", function (event) {
		if (window.bfPalette && window.bfPalette.isOpen()) {
			if (event.key === "Escape") {
				event.preventDefault();
				window.bfPalette.close();
			}
			return;
		}
		if (window.bfKeys.isOpen()) return;
		var target = event.target;
		var editable = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
		if (editable) return;
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
			event.preventDefault();
			window.bfPalette.open();
			return;
		}
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (event.key === "/") {
			event.preventDefault();
			window.bfPalette.open();
		} else if (event.key === "?") {
			event.preventDefault();
			window.bfKeys.toggle();
		} else if (event.key === "u" && wrapButton) {
			event.preventDefault();
			wrapButton.click();
		} else if (event.key === "y" && document.getElementById("copy-reference")) {
			event.preventDefault();
			copyReference();
		} else if (event.key === "r" && document.querySelector(".bf-card__actions .bf-segmented")) {
			event.preventDefault();
			toggleRaw();
		} else if (event.key === "n" && hunkAnchors.length > 0) {
			event.preventDefault();
			moveHunk(1);
		} else if (event.key === "p" && hunkAnchors.length > 0) {
			event.preventDefault();
			moveHunk(-1);
		} else if (event.key === "-" && document.getElementById("fold-all")) {
			event.preventDefault();
			document.getElementById("fold-all").click();
		}
	});

${LIVE_CLIENT_JS}})();
`;
