/**
 * The browse page's sidebar: the path filter, the fold-all control, the lazy
 * tree, and the tree's keyboard model.
 *
 * It is a fragment of the same IIFE `client.ts` ships (`TREE_CLIENT_JS` is
 * interpolated into `CLIENT_JS`), kept in its own module because the sidebar is
 * one concern with its own state: the filter query, each folder's `data-open`
 * intent, and the one row the keyboard is on.
 */

import { SIDEBAR_COLLAPSE_MAX } from "../../../lib/web/index.ts";

export const TREE_CLIENT_JS = `	var tree = document.querySelector("nav.bf-tree");
	var filter = document.getElementById("filter");
	var foldAllButton = document.getElementById("fold-all");
	var query = "";

	function matches(text) {
		return !query || text.toLowerCase().indexOf(query) !== -1;
	}

	// A row is found from inside it (an event target) or from its own list item:
	// closest() only looks upwards, so paint() cannot start from the li.
	function rowOf(node) {
		var row = node && node.closest ? node.closest(".bf-tree__row") : null;
		return row && tree && tree.contains(row) ? row : null;
	}

	function rowFor(li) {
		return li ? li.querySelector(":scope > .bf-tree__row") : null;
	}

	function rowLink(row) {
		return row ? row.querySelector("a") : null;
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
			twisty.tabIndex = -1;
			twisty.setAttribute("aria-hidden", "true");
			twisty.textContent = "\\u25B8";
			var dir = document.createElement("a");
			dir.href = entry.href;
			dir.tabIndex = -1;
			dir.setAttribute("aria-expanded", "false");
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
			file.tabIndex = -1;
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
		Array.prototype.forEach.call(document.querySelectorAll("table.bf-table tbody tr"), function (row) {
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
		var row = rowFor(li);
		var twisty = row ? row.querySelector(":scope > .bf-tree__tw") : null;
		if (!twisty || twisty.tagName !== "BUTTON") return;
		var open = isOpen(li);
		// A pending load owns the glyph until it lands or fails.
		if (!li.dataset.loading && !li.dataset.error) twisty.textContent = open ? "\\u25BE" : "\\u25B8";
		var link = rowLink(row);
		if (link) link.setAttribute("aria-expanded", open ? "true" : "false");
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
		var link = rowLink(rowFor(li));
		var name = link ? link.textContent.slice(0, -1) : path;
		li.dataset.loading = "true";
		twisty.textContent = "\\u2026";
		if (link) link.setAttribute("aria-busy", "true");
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
				if (link) link.setAttribute("aria-busy", "false");
				applyFilter();
			})
			.catch(function () {
				delete li.dataset.loading;
				li.dataset.error = "true";
				li.dataset.open = "false";
				twisty.textContent = "\\u26A0";
				twisty.title = "Could not load " + name + ". Press to retry.";
				if (link) {
					link.setAttribute("aria-busy", "false");
					link.setAttribute("aria-expanded", "false");
				}
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

	// The tree is one tab stop. Arrows move between the rows a reader can see,
	// Right opens a folder (reading it first when it has never been loaded),
	// Left closes it or steps out to the parent, Space toggles, and Enter follows
	// the focused link itself — the row is a link, so the browser owns activation.
	function treeRows() {
		return tree ? Array.prototype.slice.call(tree.querySelectorAll(".bf-tree__row")) : [];
	}

	function visibleRows() {
		return treeRows().filter(function (row) { return row.getClientRects().length > 0; });
	}

	function setTabStop(row) {
		treeRows().forEach(function (other) {
			var link = rowLink(other);
			if (link) link.tabIndex = other === row ? 0 : -1;
		});
	}

	function focusRow(row) {
		if (!row) return;
		setTabStop(row);
		var link = rowLink(row);
		if (link) link.focus();
	}

	function moveFocus(row, delta) {
		var rows = visibleRows();
		var at = rows.indexOf(row);
		if (at >= 0) focusRow(rows[at + delta]);
	}

	function parentRowOf(row) {
		var li = row.parentNode;
		var list = li ? li.parentNode : null;
		var parentLi = list && list.closest ? list.closest("li") : null;
		return parentLi ? parentLi.querySelector(":scope > .bf-tree__row") : null;
	}

	// A folder that has never been expanded has no child list yet; opening it is
	// the same request the twisty makes, so the keyboard reuses it.
	function openFolder(row) {
		var li = row.parentNode;
		var twisty = row.querySelector(".bf-tree__tw--toggle");
		if (!li || !twisty) return null;
		var list = li.querySelector(":scope > ul");
		if (list) return list;
		var path = row.getAttribute("data-path");
		if (path) loadChildren(li, twisty, path);
		return null;
	}

	function expandRow(row) {
		var li = row.parentNode;
		if (!li || !row.querySelector(".bf-tree__tw--toggle")) return;
		var list = openFolder(row);
		if (!list) return;
		if (!isOpen(li)) {
			setOpen(li, true);
			applyFilter();
			return;
		}
		var rows = visibleRows();
		var next = rows[rows.indexOf(row) + 1];
		if (next && parentRowOf(next) === row) focusRow(next);
	}

	function collapseRow(row) {
		var li = row.parentNode;
		if (li && li.querySelector(":scope > ul") && isOpen(li)) {
			setOpen(li, false);
			applyFilter();
			return;
		}
		focusRow(parentRowOf(row));
	}

	function toggleRow(row) {
		var li = row.parentNode;
		if (!li || !row.querySelector(".bf-tree__tw--toggle")) return;
		if (!openFolder(row)) return;
		setOpen(li, li.dataset.open !== "true");
		applyFilter();
	}

	if (tree) {
		tree.addEventListener("keydown", function (event) {
			var row = rowOf(event.target);
			if (!row || event.metaKey || event.ctrlKey || event.altKey) return;
			var rows = visibleRows();
			if (event.key === "ArrowDown") moveFocus(row, 1);
			else if (event.key === "ArrowUp") moveFocus(row, -1);
			else if (event.key === "Home") focusRow(rows[0]);
			else if (event.key === "End") focusRow(rows[rows.length - 1]);
			else if (event.key === "ArrowRight") expandRow(row);
			else if (event.key === "ArrowLeft") collapseRow(row);
			else if (event.key === " " && row.querySelector(".bf-tree__tw--toggle")) toggleRow(row);
			else return;
			// The page keymap treats a bare key as its own; the tree keeps its own.
			event.preventDefault();
			event.stopPropagation();
		});
		// A pointer click lands on one row, so that row becomes the tab stop the
		// next Tab returns to.
		tree.addEventListener("focusin", function (event) {
			var row = rowOf(event.target);
			if (row) setTabStop(row);
		});
	}

	// The current page's row, else the first one, is the way into the tree.
	setTabStop(tree && tree.querySelector(".bf-tree__row[aria-current]") || (tree ? treeRows()[0] : null));

	var panel = document.querySelector("details.bf-app__sidebar");
	if (panel && window.matchMedia) {
		var mq = window.matchMedia("(max-width: ${SIDEBAR_COLLAPSE_MAX}px)");
		var syncSide = function () { panel.open = !mq.matches; };
		syncSide();
		if (mq.addEventListener) mq.addEventListener("change", syncSide);
		else if (mq.addListener) mq.addListener(syncSide);
	}

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
`;
