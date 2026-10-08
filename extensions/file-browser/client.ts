/**
 * The first-party browser script, served as `/app.js`.
 *
 * It is intentionally tiny and dependency-free: it only progressively enhances
 * what the server already rendered — filtering the tree and listing, lazily
 * expanding folders through `/api/tree`, and swapping a broken thumbnail for its
 * category icon. Navigation works without it.
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
		var twisty = document.createElement(entry.isDir ? "button" : "span");
		twisty.className = "tw";
		row.appendChild(twisty);
		row.appendChild(svgIcon(entry));
		var link = document.createElement("a");
		link.href = entry.href;
		link.textContent = entry.isDir ? entry.name + "/" : entry.name;
		if (entry.isDir) {
			li.dataset.open = "false";
			twisty.type = "button";
			twisty.textContent = "\\u25B8";
			twisty.setAttribute("aria-expanded", "false");
			twisty.setAttribute("aria-label", entry.name);
			link.setAttribute("data-path", entry.path);
		} else {
			twisty.className = "tw spacer";
			twisty.setAttribute("aria-hidden", "true");
		}
		row.appendChild(link);
		li.appendChild(row);
		return li;
	}

	function filterNode(li) {
		var link = li.querySelector(":scope > .row a");
		var own = matches(link ? link.textContent : "");
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
			row.hidden = !matches(row.getAttribute("data-name") || "");
		});
	}

	if (filter) {
		filter.addEventListener("input", function () {
			query = filter.value.trim().toLowerCase();
			applyFilter();
		});
	}

	if (tree) {
		tree.addEventListener("click", function (event) {
			var twisty = event.target.closest(".tw");
			if (!twisty || !tree.contains(twisty)) return;
			event.preventDefault();
			var li = twisty.closest("li");
			if (!li) return;
			var open = li.dataset.open === "true";
			var list = li.querySelector(":scope > ul");
			if (open) {
				li.dataset.open = "false";
				twisty.textContent = "\\u25B8";
				twisty.setAttribute("aria-expanded", "false");
				if (list) list.hidden = true;
				return;
			}
			li.dataset.open = "true";
			twisty.textContent = "\\u25BE";
			twisty.setAttribute("aria-expanded", "true");
			if (list) {
				list.hidden = false;
				applyFilter();
				return;
			}
			var link = li.querySelector(":scope > .row a");
			var path = link ? link.getAttribute("data-path") : null;
			if (!path) return;
			fetch("/api/tree?path=" + encodeURIComponent(path))
				.then(function (response) { return response.json(); })
				.then(function (data) {
					var built = document.createElement("ul");
					(data.entries || []).forEach(function (entry) {
						built.appendChild(buildNode(entry));
					});
					li.appendChild(built);
					applyFilter();
				})
				.catch(function () {
					li.dataset.open = "false";
					twisty.textContent = "\\u25B8";
					twisty.setAttribute("aria-expanded", "false");
				});
		});
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
