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

export const CLIENT_JS = `(function () {
	"use strict";

	var tree = document.querySelector("nav.tree");
	var filter = document.getElementById("filter");
	var rows = Array.prototype.slice.call(document.querySelectorAll("table.listing tbody tr"));
	var query = "";

	function matches(text) {
		return !query || text.toLowerCase().indexOf(query) !== -1;
	}

	var SVG_NS = "http://www.w3.org/2000/svg";

	function svgIcon(entry) {
		var svg = document.createElementNS(SVG_NS, "svg");
		svg.setAttribute("class", "cat " + (entry.colorClass || ""));
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
		row.className = "row";
		row.setAttribute("data-path", entry.path || "");
		var twisty = document.createElement(entry.isDir ? "button" : "span");
		twisty.className = "tw";
		row.appendChild(twisty);
		row.appendChild(svgIcon(entry));
		if (entry.isDir) {
			li.dataset.open = "false";
			twisty.classList.add("toggle");
			twisty.type = "button";
			twisty.textContent = "\\u25B8";
			twisty.setAttribute("aria-expanded", "false");
			twisty.setAttribute("aria-label", entry.name);
			var dir = document.createElement("a");
			dir.href = entry.href;
			dir.textContent = entry.name + "/";
			row.appendChild(dir);
		} else if (entry.broken) {
			twisty.className = "tw spacer";
			twisty.setAttribute("aria-hidden", "true");
			var broken = document.createElement("span");
			broken.className = "broken";
			broken.title = "broken symbolic link";
			broken.textContent = entry.name;
			row.appendChild(broken);
			var mark = document.createElement("span");
			mark.className = "link-mark";
			mark.textContent = "\\u21A9";
			row.appendChild(mark);
		} else {
			twisty.className = "tw spacer";
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
		var row = li.querySelector(":scope > .row");
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
	}

	if (filter) {
		filter.addEventListener("input", function () {
			query = filter.value.trim().toLowerCase();
			applyFilter();
		});
	}

	function setOpen(li, twisty, list, open) {
		li.dataset.open = open ? "true" : "false";
		twisty.textContent = open ? "\\u25BE" : "\\u25B8";
		twisty.setAttribute("aria-expanded", open ? "true" : "false");
		if (list) list.hidden = !open;
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
				setOpen(li, twisty, built, true);
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
			var twisty = event.target.closest(".tw");
			if (!twisty || twisty.tagName !== "BUTTON" || !tree.contains(twisty)) return;
			event.preventDefault();
			var li = twisty.closest("li");
			if (!li) return;
			var list = li.querySelector(":scope > ul");
			if (li.dataset.open === "true") {
				setOpen(li, twisty, list, false);
				return;
			}
			if (list) {
				setOpen(li, twisty, list, true);
				applyFilter();
				return;
			}
			var row = li.querySelector(":scope > .row");
			var path = row ? row.getAttribute("data-path") : null;
			if (!path) return;
			loadChildren(li, twisty, path);
		});
	}

	var panel = document.querySelector("details.side-panel");
	if (panel && window.matchMedia) {
		var mq = window.matchMedia("(max-width: 720px)");
		var syncSide = function () { panel.open = !mq.matches; };
		syncSide();
		if (mq.addEventListener) mq.addEventListener("change", syncSide);
		else if (mq.addListener) mq.addListener(syncSide);
	}

	Array.prototype.forEach.call(document.querySelectorAll("img.thumb"), function (img) {
		img.addEventListener("error", function () {
			img.hidden = true;
			var fallback = img.parentElement && img.parentElement.querySelector(".cat");
			if (fallback) fallback.hidden = false;
		});
	});
})();
`;
