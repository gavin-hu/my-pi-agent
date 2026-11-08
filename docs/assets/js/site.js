/*
 * The site's behaviour: the theme switch, the narrow-screen navigation drawer,
 * the on-this-page rail, and search over `search.json`.
 *
 * Each runs only when its markup exists, so the same file serves every layout.
 */
(function () {
	"use strict";

	var root = document.documentElement;

	/* Theme ---------------------------------------------------------------- */

	var themeButton = document.querySelector(".theme-toggle");
	var themeIcon = themeButton ? themeButton.querySelector(".theme-icon") : null;

	function describeTheme(theme) {
		if (themeButton) {
			themeButton.setAttribute(
				"aria-label",
				theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme",
			);
			themeButton.setAttribute("title", theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme");
		}
		if (themeIcon) themeIcon.textContent = theme === "dark" ? "☀" : "◐";
	}

	function applyTheme(theme) {
		root.dataset.theme = theme;
		describeTheme(theme);
	}

	function toggleTheme() {
		var next = root.dataset.theme === "dark" ? "light" : "dark";
		applyTheme(next);
		try {
			localStorage.setItem("theme", next);
		} catch (error) {
			// A private window can refuse storage; the choice then lasts this page only.
		}
	}

	describeTheme(root.dataset.theme === "dark" ? "dark" : "light");
	if (themeButton) themeButton.addEventListener("click", toggleTheme);

	/* Navigation drawer ---------------------------------------------------- */

	var navToggle = document.querySelector(".nav-toggle");
	var nav = document.getElementById("nav");

	function closeNav() {
		if (!nav || !nav.classList.contains("is-open")) return;
		nav.classList.remove("is-open");
		if (navToggle) {
			navToggle.setAttribute("aria-expanded", "false");
			navToggle.setAttribute("aria-label", "Open navigation");
		}
	}

	if (navToggle && nav) {
		navToggle.addEventListener("click", function () {
			var open = !nav.classList.contains("is-open");
			nav.classList.toggle("is-open", open);
			navToggle.setAttribute("aria-expanded", open ? "true" : "false");
			navToggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
		});
		nav.addEventListener("click", function (event) {
			if (event.target instanceof Element && event.target.closest("a")) closeNav();
		});
	}

	document.addEventListener("keydown", function (event) {
		if (event.key !== "Escape") return;
		closeNav();
		var searchInput = document.getElementById("search-input");
		if (searchInput) searchInput.blur();
	});

	/* On this page --------------------------------------------------------- */

	var toc = document.getElementById("toc");
	var tocLinks = document.getElementById("toc-links");
	var headings = [].slice.call(document.querySelectorAll(".prose h2[id], .prose h3[id]")).filter(function (heading) {
		return heading.textContent && heading.textContent.trim() !== "";
	});

	if (toc && tocLinks && headings.length >= 2) {
		var tocById = {};
		headings.forEach(function (heading) {
			var link = document.createElement("a");
			link.className = heading.tagName === "H3" ? "toc-link is-nested" : "toc-link";
			link.href = "#" + heading.id;
			link.textContent = heading.textContent.trim();
			tocLinks.appendChild(link);
			tocById[heading.id] = link;
		});
		toc.hidden = false;

		var active = null;
		var ticking = false;

		function markActive() {
			ticking = false;
			var offset = window.scrollY + 120;
			var current = headings[0];
			for (var i = 0; i < headings.length; i++) {
				if (headings[i].offsetTop <= offset) current = headings[i];
			}
			if (!current) return;
			var link = tocById[current.id];
			if (!link || link === active) return;
			if (active) active.classList.remove("is-active");
			link.classList.add("is-active");
			active = link;
		}

		window.addEventListener("scroll", function () {
			if (ticking) return;
			ticking = true;
			window.requestAnimationFrame(markActive);
		});
		markActive();
	}

	/* Search --------------------------------------------------------------- */

	var input = document.getElementById("search-input");
	var list = document.getElementById("search-results");

	if (!input || !list) return;

	var indexURL = input.dataset.searchIndex;
	var docs = null;
	var loading = false;
	var selected = -1;
	var options = [];

	function open() {
		if (options.length > 0) list.hidden = false;
		input.setAttribute("aria-expanded", "true");
	}

	function close() {
		list.hidden = true;
		input.setAttribute("aria-expanded", "false");
		selected = -1;
	}

	function load() {
		if (docs || loading || !indexURL) return;
		loading = true;
		fetch(indexURL)
			.then(function (response) {
				if (!response.ok) throw new Error("search index unavailable");
				return response.json();
			})
			.then(function (data) {
				docs = Array.isArray(data) ? data : [];
				loading = false;
				if (input.value.trim() !== "") search(input.value);
			})
			.catch(function () {
				loading = false;
			});
	}

	function score(doc, terms) {
		var title = (doc.title || "").toLowerCase();
		var summary = (doc.summary || "").toLowerCase();
		var text = (doc.text || "").toLowerCase();
		var total = 0;
		terms.forEach(function (term) {
			if (title.indexOf(term) !== -1) total += 6;
			if (summary.indexOf(term) !== -1) total += 3;
			if (text.indexOf(term) !== -1) total += 1;
		});
		return total;
	}

	function resultFor(doc) {
		var item = document.createElement("li");
		var link = document.createElement("a");
		var group = document.createElement("span");
		var title = document.createElement("span");
		var summary = document.createElement("span");

		link.className = "search-result";
		link.href = doc.url;
		group.className = "search-result-group";
		group.textContent = doc.group || "";
		title.className = "search-result-title";
		title.textContent = doc.title || doc.url;
		summary.className = "search-result-summary";
		summary.textContent = doc.summary || "";

		link.appendChild(group);
		link.appendChild(title);
		link.appendChild(summary);
		item.appendChild(link);
		return item;
	}

	function search(value) {
		var query = value.trim().toLowerCase();
		list.textContent = "";
		options = [];
		selected = -1;
		if (query === "") {
			close();
			return;
		}
		var terms = query.split(/\s+/).filter(Boolean);
		var ranked = (docs || [])
			.map(function (doc) {
				return { doc: doc, score: score(doc, terms) };
			})
			.filter(function (entry) {
				return entry.score > 0;
			})
			.sort(function (a, b) {
				return b.score - a.score;
			})
			.slice(0, 8);

		if (ranked.length === 0) {
			var empty = document.createElement("li");
			empty.className = "search-empty";
			empty.textContent = docs ? "No page matches that." : "Loading the index…";
			list.appendChild(empty);
			list.hidden = false;
			input.setAttribute("aria-expanded", "true");
			return;
		}

		ranked.forEach(function (entry) {
			var item = resultFor(entry.doc);
			list.appendChild(item);
			options.push(item.querySelector("a"));
		});
		open();
	}

	function select(delta) {
		if (options.length === 0) return;
		if (selected >= 0) options[selected].classList.remove("is-selected");
		selected = (selected + delta + options.length) % options.length;
		options[selected].classList.add("is-selected");
		options[selected].scrollIntoView({ block: "nearest" });
	}

	input.addEventListener("focus", load);
	input.addEventListener("input", function () {
		load();
		search(input.value);
	});

	input.addEventListener("keydown", function (event) {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			select(1);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			select(-1);
		} else if (event.key === "Enter") {
			var target = options[selected >= 0 ? selected : 0];
			if (target) {
				event.preventDefault();
				window.location.href = target.href;
			}
		} else if (event.key === "Escape") {
			close();
			input.blur();
		}
	});

	document.addEventListener("click", function (event) {
		if (event.target instanceof Element && !event.target.closest(".search")) close();
	});
})();
