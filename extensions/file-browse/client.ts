/**
 * The first-party browser script, served as `/app.js`.
 *
 * It is intentionally tiny and dependency-free: it only progressively enhances
 * what the server already rendered — filtering the tree and listing by path,
 * lazily expanding folders through `/api/tree` (with loading and error
 * feedback), collapsing the sidebar on narrow viewports, and swapping a broken
 * thumbnail for its category icon. Navigation works without it.
 *
 * Kept as a string constant so the extension is a single self-contained module
 * and `bun build --no-bundle` needs no separate asset.
 */

import { SIDEBAR_COLLAPSE_MAX, THEME_TOGGLE_JS } from "../../lib/web/index.ts";

export const CLIENT_JS = `(function () {
	"use strict";
	var tree = document.querySelector("nav.bf-tree");
	var filter = document.getElementById("filter");
	var foldAllButton = document.getElementById("fold-all");
	var rows = Array.prototype.slice.call(document.querySelectorAll("table.bf-table tbody tr"));
	var query = "";

	function matches(text) {
		return !query || text.toLowerCase().indexOf(query) !== -1;
	}

	var SVG_NS = "http://www.w3.org/2000/svg";

	function svgIcon(entry) {
		var svg = document.createElementNS(SVG_NS, "svg");
		svg.setAttribute("class", "browse-cat " + (entry.colorClass || ""));
		svg.setAttribute("aria-hidden", "true");
		svg.setAttribute("title", entry.label || "");
		var use = document.createElementNS(SVG_NS, "use");
		use.setAttribute("href", entry.iconHref);
		svg.appendChild(use);
		return svg;
	}

	function buildNode(entry) {
		var li = document.createElement("li");
		var row = document.createElement("div");
		row.className = "bf-tree__row";
		row.setAttribute("data-path", entry.path || "");
		var twisty = document.createElement(entry.isDir ? "button" : "span");
		twisty.className = "bf-tree__tw";
		row.appendChild(twisty);
		row.appendChild(svgIcon(entry));
		if (entry.isDir) {
			li.dataset.open = "false";
			twisty.classList.add("bf-tree__tw--toggle");
			twisty.type = "button";
			twisty.textContent = "\\u25B8";
			twisty.setAttribute("aria-expanded", "false");
			twisty.setAttribute("aria-label", entry.name);
			var dir = document.createElement("a");
			dir.href = entry.href;
			dir.textContent = entry.name + "/";
			row.appendChild(dir);
		} else if (entry.broken) {
			twisty.className = "bf-tree__tw bf-tree__tw--spacer";
			twisty.setAttribute("aria-hidden", "true");
			var broken = document.createElement("span");
			broken.className = "browse-broken";
			broken.title = "broken symbolic link";
			broken.textContent = entry.name;
			row.appendChild(broken);
			var mark = document.createElement("span");
			mark.className = "browse-link-mark";
			mark.textContent = "\\u21A9";
			row.appendChild(mark);
		} else {
			twisty.className = "bf-tree__tw bf-tree__tw--spacer";
			twisty.setAttribute("aria-hidden", "true");
			var file = document.createElement("a");
			file.href = entry.href;
			file.textContent = entry.name;
			row.appendChild(file);
		}
		li.appendChild(row);
		return li;
	}

	function filterNode(li) {
		var row = li.querySelector(":scope > .bf-tree__row");
		var own = matches(row ? row.getAttribute("data-path") || row.textContent : "");
		var childMatch = false;
		Array.prototype.forEach.call(li.querySelectorAll(":scope > ul > li"), function (child) {
			if (filterNode(child)) childMatch = true;
		});
		var visible = own || childMatch;
		li.hidden = !visible;
		return visible;
	}

	function applyFilter() {
		var empty = document.getElementById("tree-empty");
		var anyTree = false;
		if (tree) {
			Array.prototype.forEach.call(tree.querySelectorAll(":scope > ul > li"), function (li) {
				if (filterNode(li)) anyTree = true;
			});
		}
		if (empty) empty.hidden = !tree || anyTree;
		rows.forEach(function (row) {
			var path = row.getAttribute("data-path") || row.getAttribute("data-name") || "";
			row.hidden = !matches(path);
		});
		// Lists are repainted too: while a query is active every list is shown, and
		// clearing the query brings the folds back.
		if (tree) Array.prototype.forEach.call(tree.querySelectorAll("li[data-open]"), paint);
	}

	if (filter) {
		filter.addEventListener("input", function () {
			query = filter.value.trim().toLowerCase();
			applyFilter();
		});
	}

	// Visibility is derived: the intent in data-open, opened up while a filter is
	// active so a fold cannot hide a match.
	function isOpen(li) {
		return query !== "" || li.dataset.open === "true";
	}

	function paint(li) {
		var row = li.querySelector(":scope > .bf-tree__row");
		var twisty = row ? row.querySelector(":scope > .bf-tree__tw") : null;
		if (!twisty || twisty.tagName !== "BUTTON") return;
		var open = isOpen(li);
		// A pending load owns the glyph until it lands or fails.
		if (!li.dataset.loading && !li.dataset.error) {
			twisty.textContent = open ? "\\u25BE" : "\\u25B8";
			twisty.setAttribute("aria-expanded", open ? "true" : "false");
		}
		var list = li.querySelector(":scope > ul");
		if (list) list.hidden = !open;
	}

	function setOpen(li, open) {
		li.dataset.open = open ? "true" : "false";
		paint(li);
	}

	// Every dir with rendered children: what the fold-all control acts on.
	function foldableDirs() {
		var dirs = [];
		if (!tree) return dirs;
		Array.prototype.forEach.call(tree.querySelectorAll("li"), function (li) {
			if (li.querySelector(":scope > ul")) dirs.push(li);
		});
		return dirs;
	}

	function syncFoldButton() {
		if (!foldAllButton) return;
		var dirs = foldableDirs();
		var open = 0;
		dirs.forEach(function (li) {
			if (li.dataset.open === "true") open++;
		});
		foldAllButton.hidden = dirs.length === 0;
		foldAllButton.textContent = open > 0 ? "fold all" : "expand all";
	}

	function setAll(open) {
		foldableDirs().forEach(function (li) {
			setOpen(li, open);
		});
		syncFoldButton();
	}

	function loadChildren(li, twisty, path) {
		var name = twisty.getAttribute("aria-label") || "";
		li.dataset.loading = "true";
		twisty.textContent = "\\u2026";
		twisty.setAttribute("aria-busy", "true");
		twisty.setAttribute("aria-label", "Loading " + name);
		fetch("/api/tree?path=" + encodeURIComponent(path))
			.then(function (response) {
				if (!response.ok) throw new Error("load failed");
				return response.json();
			})
			.then(function (data) {
				var built = document.createElement("ul");
				(data.entries || []).forEach(function (entry) {
					built.appendChild(buildNode(entry));
				});
				li.appendChild(built);
				delete li.dataset.loading;
				delete li.dataset.error;
				setOpen(li, true);
				twisty.setAttribute("aria-busy", "false");
				twisty.setAttribute("aria-label", name);
				applyFilter();
			})
			.catch(function () {
				delete li.dataset.loading;
				li.dataset.error = "true";
				li.dataset.open = "false";
				twisty.textContent = "\\u26A0";
				twisty.setAttribute("aria-busy", "false");
				twisty.setAttribute("aria-expanded", "false");
				twisty.setAttribute("aria-label", "Could not load " + name + ". Press to retry.");
			});
	}

	if (tree) {
		tree.addEventListener("click", function (event) {
			var twisty = event.target.closest(".bf-tree__tw");
			if (!twisty || twisty.tagName !== "BUTTON" || !tree.contains(twisty)) return;
			event.preventDefault();
			var li = twisty.closest("li");
			if (!li) return;
			var list = li.querySelector(":scope > ul");
			if (li.dataset.open === "true") {
				setOpen(li, false);
				return;
			}
			if (list) {
				setOpen(li, true);
				applyFilter();
				return;
			}
			var row = li.querySelector(":scope > .bf-tree__row");
			var path = row ? row.getAttribute("data-path") : null;
			if (!path) return;
			loadChildren(li, twisty, path);
		});
	}

	var panel = document.querySelector("details.bf-app__sidebar");
	if (panel && window.matchMedia) {
		var mq = window.matchMedia("(max-width: ${SIDEBAR_COLLAPSE_MAX}px)");
		var syncSide = function () { panel.open = !mq.matches; };
		syncSide();
		if (mq.addEventListener) mq.addEventListener("change", syncSide);
		else if (mq.addListener) mq.addListener(syncSide);
	}

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

	// Quick open: a fuzzy path palette backed by /api/files.
	var quickOpenButton = document.getElementById("quick-open");
	var paletteBackdrop = null;
	var paletteInput = null;
	var paletteList = null;
	var paletteStatus = null;
	var paletteResults = [];
	var paletteActive = -1;
	var paletteTimer = null;

	function paletteOpen() {
		return paletteBackdrop !== null && paletteBackdrop.hidden === false;
	}

	function encodeSegments(path) {
		return path.split("/").map(encodeURIComponent).join("/");
	}

	function closestRole(node, role) {
		while (node && node !== paletteList) {
			if (node.getAttribute && node.getAttribute("role") === role) return node;
			node = node.parentNode;
		}
		return null;
	}

	function buildPalette() {
		if (paletteBackdrop) return;
		paletteBackdrop = document.createElement("div");
		paletteBackdrop.className = "bf-dialog";
		paletteBackdrop.hidden = true;
		var dialog = document.createElement("div");
		dialog.className = "bf-dialog__panel";
		dialog.setAttribute("role", "dialog");
		dialog.setAttribute("aria-modal", "true");
		dialog.setAttribute("aria-label", "Quick open a file");
		paletteInput = document.createElement("input");
		paletteInput.type = "text";
		paletteInput.className = "bf-dialog__input";
		paletteInput.id = "palette-input";
		paletteInput.setAttribute("role", "combobox");
		paletteInput.setAttribute("aria-expanded", "true");
		paletteInput.setAttribute("aria-controls", "palette-list");
		paletteInput.setAttribute("aria-autocomplete", "list");
		paletteInput.setAttribute("autocomplete", "off");
		paletteInput.setAttribute("placeholder", "Type a file path…");
		paletteInput.setAttribute("aria-label", "Quick open a file");
		paletteList = document.createElement("ul");
		paletteList.className = "bf-dialog__list";
		paletteList.id = "palette-list";
		paletteList.setAttribute("role", "listbox");
		paletteStatus = document.createElement("p");
		paletteStatus.className = "bf-dialog__status";
		paletteStatus.setAttribute("role", "status");
		dialog.appendChild(paletteInput);
		dialog.appendChild(paletteList);
		dialog.appendChild(paletteStatus);
		paletteBackdrop.appendChild(dialog);
		document.body.appendChild(paletteBackdrop);

		paletteBackdrop.addEventListener("mousedown", function (event) {
			if (event.target === paletteBackdrop) closePalette();
		});
		paletteInput.addEventListener("input", function () {
			if (paletteTimer) window.clearTimeout(paletteTimer);
			paletteTimer = window.setTimeout(runSearch, 80);
		});
		paletteInput.addEventListener("keydown", function (event) {
			if (event.key === "Tab") {
				event.preventDefault();
			} else if (event.key === "ArrowDown" || (event.ctrlKey && event.key === "n")) {
				event.preventDefault();
				moveActive(1);
			} else if (event.key === "ArrowUp" || (event.ctrlKey && event.key === "p")) {
				event.preventDefault();
				moveActive(-1);
			} else if (event.key === "Enter") {
				event.preventDefault();
				openActive();
			} else if (event.key === "Escape") {
				event.preventDefault();
				closePalette();
			}
		});
		paletteList.addEventListener("mousemove", function (event) {
			var option = closestRole(event.target, "option");
			if (option) setActive(Number(option.getAttribute("data-index")));
		});
		paletteList.addEventListener("click", function (event) {
			var option = closestRole(event.target, "option");
			if (option) {
				setActive(Number(option.getAttribute("data-index")));
				openActive();
			}
		});
	}

	function openPalette() {
		buildPalette();
		paletteBackdrop.hidden = false;
		document.body.classList.add("palette-open");
		paletteInput.value = "";
		renderResults([], "Searching…");
		paletteInput.focus();
		runSearch();
	}

	function closePalette() {
		if (!paletteBackdrop) return;
		paletteBackdrop.hidden = true;
		document.body.classList.remove("palette-open");
		if (quickOpenButton) quickOpenButton.focus();
	}

	function runSearch() {
		var query = paletteInput.value.trim();
		fetch("/api/files?q=" + encodeURIComponent(query))
			.then(function (response) {
				if (!response.ok) throw new Error("search failed");
				return response.json();
			})
			.then(function (data) {
				if (paletteInput.value.trim() !== query) return;
				if (query === "") {
					renderResults([], data.total + " files indexed" + (data.truncated ? " (truncated)" : ""));
				} else {
					renderResults(data.results || [], null);
				}
			})
			.catch(function () {
				renderResults([], "Search failed");
			});
	}

	function appendHighlighted(target, path, positions) {
		var marks = {};
		(positions || []).forEach(function (index) { marks[index] = true; });
		var buffer = "";
		var marked = false;
		function flush() {
			if (buffer === "") return;
			if (marked) {
				var mark = document.createElement("mark");
				mark.textContent = buffer;
				target.appendChild(mark);
			} else {
				target.appendChild(document.createTextNode(buffer));
			}
			buffer = "";
		}
		for (var i = 0; i < path.length; i++) {
			var isMatch = marks[i] === true;
			if (isMatch !== marked) { flush(); marked = isMatch; }
			buffer += path.charAt(i);
		}
		flush();
	}

	function renderResults(results, hint) {
		paletteResults = results;
		paletteActive = results.length > 0 ? 0 : -1;
		paletteList.textContent = "";
		results.forEach(function (result, index) {
			var option = document.createElement("li");
			option.className = "bf-dialog__option";
			option.id = "palette-option-" + index;
			option.setAttribute("role", "option");
			option.setAttribute("data-index", String(index));
			appendHighlighted(option, result.path, result.positions);
			paletteList.appendChild(option);
		});
		if (hint) paletteStatus.textContent = hint;
		else if (results.length === 0) paletteStatus.textContent = "No matches";
		else paletteStatus.textContent = results.length + (results.length === 1 ? " match" : " matches");
		updateActive();
	}

	function updateActive() {
		Array.prototype.forEach.call(paletteList.children, function (option, index) {
			option.setAttribute("aria-selected", index === paletteActive ? "true" : "false");
		});
		var active = paletteList.children[paletteActive];
		if (paletteActive >= 0 && active) {
			paletteInput.setAttribute("aria-activedescendant", "palette-option-" + paletteActive);
			if (active.scrollIntoView) active.scrollIntoView({ block: "nearest" });
		} else {
			paletteInput.removeAttribute("aria-activedescendant");
		}
	}

	function setActive(index) {
		if (index < 0 || index >= paletteResults.length) return;
		paletteActive = index;
		updateActive();
	}

	function moveActive(delta) {
		if (paletteResults.length === 0) return;
		var next = paletteActive + delta;
		if (next < 0) next = paletteResults.length - 1;
		if (next >= paletteResults.length) next = 0;
		setActive(next);
	}

	function openActive() {
		var result = paletteResults[paletteActive];
		if (result) window.location.assign("/view/" + encodeSegments(result.path));
	}

	// Keyboard: a shortcut sheet, the per-page actions the server rendered, and
	// hunk-to-hunk navigation through a diff.
	var keysDialog = document.getElementById("keys-dialog");
	var keysButton = document.getElementById("keys-open");
	var hunkAnchors = Array.prototype.slice.call(document.querySelectorAll("[data-hunk]"));
	var progressFill = document.getElementById("progress-fill");

	function toggleKeys(force) {
		if (!keysDialog) return;
		var open = force !== undefined ? force : keysDialog.hidden;
		keysDialog.hidden = !open;
		if (open) {
			var close = document.getElementById("keys-close");
			if (close) close.focus();
		}
	}

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

	if (keysButton) keysButton.addEventListener("click", function () { toggleKeys(); });
	if (keysDialog) {
		keysDialog.addEventListener("click", function (event) {
			if (event.target === keysDialog) toggleKeys(false);
		});
		var keysClose = document.getElementById("keys-close");
		if (keysClose) keysClose.addEventListener("click", function () { toggleKeys(false); });
	}

	window.addEventListener("scroll", updateProgress, true);
	window.addEventListener("resize", updateProgress);
	updateProgress();
	window.addEventListener("resize", markTableOverflow);
	window.addEventListener("load", markTableOverflow);
	document.addEventListener("scroll", markTableOverflow, true);
	markTableOverflow();

	document.addEventListener("keydown", function (event) {
		if (event.key === "Escape" && keysDialog && !keysDialog.hidden) {
			event.preventDefault();
			toggleKeys(false);
			return;
		}
		if (paletteOpen()) {
			if (event.key === "Escape") {
				event.preventDefault();
				closePalette();
			}
			return;
		}
		if (keysDialog && !keysDialog.hidden) return;
		var target = event.target;
		var editable = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
		if (editable) return;
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
			event.preventDefault();
			openPalette();
			return;
		}
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (event.key === "/") {
			event.preventDefault();
			openPalette();
		} else if (event.key === "?") {
			event.preventDefault();
			toggleKeys();
		} else if (event.key === "u" && wrapButton) {
			event.preventDefault();
			wrapButton.click();
		} else if (event.key === "r" && document.querySelector(".bf-card__actions .bf-segmented")) {
			event.preventDefault();
			toggleRaw();
		} else if (event.key === "n" && hunkAnchors.length > 0) {
			event.preventDefault();
			moveHunk(1);
		} else if (event.key === "p" && hunkAnchors.length > 0) {
			event.preventDefault();
			moveHunk(-1);
		} else if (event.key === "-" && foldAllButton) {
			event.preventDefault();
			foldAllButton.click();
		}
	});

	if (quickOpenButton) quickOpenButton.addEventListener("click", openPalette);
	if (foldAllButton) {
		foldAllButton.addEventListener("click", function () {
			// The control folds when anything is open, and expands when nothing is.
			var open = false;
			foldableDirs().forEach(function (li) {
				if (li.dataset.open === "true") open = true;
			});
			setAll(!open);
		});
	}

	// The control starts in the state the rendered tree implies.
	syncFoldButton();
})();
`;
