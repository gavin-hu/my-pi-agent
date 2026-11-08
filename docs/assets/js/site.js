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
		if (themeIcon) themeIcon.textContent = theme === "dark" ? "☀" : "☾";
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
	var navGlyph = navToggle ? navToggle.querySelector(".nav-toggle-glyph") : null;
	var nav = document.getElementById("nav");
	var scrim = document.getElementById("nav-scrim");

	function activeNavLink() {
		return nav ? nav.querySelector(".nav-link.is-active") : null;
	}

	/**
	 * Bring the reader's own page into the sidebar. The sidebar is taller than the
	 * window and its scroll is the reader's alone, so without this the active link
	 * sits below the fold on any page deep in the list and the sidebar says nothing
	 * about where the reader is. The drawer is `display: none` while closed, so it
	 * can only be centered once it is open.
	 */
	function centerActiveNavLink() {
		if (!nav || nav.clientHeight === 0) return;
		var link = activeNavLink();
		if (!link) return;
		var target = link.offsetTop - (nav.clientHeight - link.offsetHeight) / 2;
		nav.scrollTop = Math.max(0, Math.min(target, nav.scrollHeight - nav.clientHeight));
	}

	function setNav(open, restoreFocus) {
		if (!nav) return;
		nav.classList.toggle("is-open", open);
		document.body.classList.toggle("is-nav-open", open);
		if (scrim) scrim.hidden = !open;
		if (navToggle) {
			navToggle.setAttribute("aria-expanded", open ? "true" : "false");
			navToggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
		}
		if (navGlyph) navGlyph.textContent = open ? "✕" : "☰";
		if (open) {
			// Focus the reader's own page rather than the first link: it is the item the
			// centering below puts in view, and focusing an anchor scrolls the drawer to
			// it anyway, so the first link's focus ring would land where nobody looks.
			var target = activeNavLink() || nav.querySelector("a");
			if (target) target.focus({ preventScroll: true });
			centerActiveNavLink();
		} else if (restoreFocus && navToggle) {
			navToggle.focus();
		}
	}

	function closeNav() {
		if (!nav || !nav.classList.contains("is-open")) return;
		setNav(false, true);
	}

	if (navToggle && nav) {
		navToggle.addEventListener("click", function () {
			setNav(!nav.classList.contains("is-open"), true);
		});
		nav.addEventListener("click", function (event) {
			if (event.target instanceof Element && event.target.closest("a")) setNav(false, false);
		});
	}
	if (scrim) scrim.addEventListener("click", closeNav);

	document.addEventListener("keydown", function (event) {
		if (event.key === "Tab" && nav && nav.classList.contains("is-open")) {
			// The drawer's links are a ring: Tab off the last one lands on the first. The
			// header above the scrim stays live, so focus already outside the drawer is
			// left where the reader put it.
			var links = nav.querySelectorAll("a");
			if (links.length === 0) return;
			var first = links[0];
			var last = links[links.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
			return;
		}
		if (event.key !== "Escape") return;
		closeNav();
		var searchInput = document.getElementById("search-input");
		if (searchInput) searchInput.blur();
	});

	centerActiveNavLink();

	// The drawer sets `body.is-nav-open`, which hides the page's overflow wherever the
	// window is; left set across the wide breakpoint it would lock the page with no
	// visible close button, so the query that ends the drawer ends it too.
	var drawerBreakpoint = window.matchMedia("(min-width: 60rem)");
	drawerBreakpoint.addEventListener("change", function (event) {
		if (event.matches) setNav(false, false);
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
			// Nothing is marked until a section is really under the header: the page's
			// own opening is not the first section, and marking it would claim the
			// reader is somewhere they are not.
			var current = null;
			for (var i = 0; i < headings.length; i++) {
				if (headings[i].offsetTop <= offset) current = headings[i];
			}
			var link = current ? tocById[current.id] : null;
			if (link === active) return;
			if (active) active.classList.remove("is-active");
			active = link;
			if (link) link.classList.add("is-active");
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
	var status = document.getElementById("search-status");

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
		input.removeAttribute("aria-activedescendant");
		selected = -1;
	}

	function announce(message) {
		if (status) status.textContent = message;
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

	function resultFor(doc, index) {
		var item = document.createElement("li");
		var link = document.createElement("a");
		var group = document.createElement("span");
		var title = document.createElement("span");
		var summary = document.createElement("span");

		item.id = "search-option-" + index;
		item.setAttribute("role", "option");
		item.setAttribute("aria-selected", "false");
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
			announce("");
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
			announce(docs ? "No page matches that." : "Loading the index.");
			return;
		}

		ranked.forEach(function (entry, index) {
			var item = resultFor(entry.doc, index);
			list.appendChild(item);
			options.push(item.querySelector("a"));
		});
		open();
		announce(ranked.length + (ranked.length === 1 ? " result." : " results."));
	}

	function select(delta) {
		if (options.length === 0) return;
		if (selected >= 0) {
			options[selected].classList.remove("is-selected");
			options[selected].parentElement?.setAttribute("aria-selected", "false");
		}
		selected = (selected + delta + options.length) % options.length;
		var option = options[selected];
		option.classList.add("is-selected");
		option.parentElement?.setAttribute("aria-selected", "true");
		if (option.parentElement?.id) input.setAttribute("aria-activedescendant", option.parentElement.id);
		option.scrollIntoView({ block: "nearest" });
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
