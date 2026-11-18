/**
 * The quick-open palette: a fuzzy path search over `/api/files`.
 *
 * It is a fragment of the same IIFE `client.ts` ships (`PALETTE_CLIENT_JS` is
 * interpolated into `CLIENT_JS`). The page's keymap opens it through
 * `window.bfPalette`, the same contract shape as `window.bfKeys`.
 */

export const PALETTE_CLIENT_JS = `	// Quick open: a fuzzy path palette backed by /api/files.
	var quickOpenButton = document.getElementById("quick-open");
	var paletteBackdrop = null;
	var paletteInput = null;
	var paletteList = null;
	var paletteStatus = null;
	var paletteResults = [];
	var paletteActive = -1;
	var paletteTimer = null;
	// What the last answer said: how many paths the walk found, and the folders it never
	// entered. Both come from the server, so this bundle names no directory.
	var paletteTotal = 0;
	var paletteSkipped = [];

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
		fetch(pageBase() + "/api/files?q=" + encodeURIComponent(query))
			.then(function (response) {
				if (!response.ok) throw new Error("search failed");
				return response.json();
			})
			.then(function (data) {
				if (paletteInput.value.trim() !== query) return;
				paletteTotal = data.total || 0;
				paletteSkipped = data.skipped || [];
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
		else if (results.length === 0) paletteStatus.textContent = noMatchText();
		else paletteStatus.textContent = results.length + (results.length === 1 ? " match" : " matches");
		updateActive();
	}

	/** "a", "a and b", "a, b and c": the list the server sent, in the order it sent it. */
	function joinNames(names) {
		if (names.length < 2) return names.join("");
		return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
	}

	/**
	 * Why a search found nothing.
	 *
	 * The walk never enters the folders in INDEX_IGNORED_DIRS, so the palette owed a reader the
	 * reason rather than "No matches" beside a file they can see in the tree. A query that opens
	 * with one of those folders says so directly, because that is the reader asking for the
	 * excluded thing; anything else names the whole excluded set, and a root without one keeps
	 * the words it had.
	 */
	function noMatchText() {
		// A leading slash is how a reader pastes a path, and the index holds root-relative ones;
		// stripped by hand because this fragment is a template literal: an escaped slash written
		// for a regex arrives at the browser as a bare one, and the whole script stops parsing.
		var query = paletteInput.value.trim();
		while (query.charAt(0) === "/") query = query.slice(1);
		var inside = "";
		paletteSkipped.forEach(function (name) {
			if (inside === "" && (query === name || query.indexOf(name + "/") === 0)) inside = name;
		});
		if (inside !== "") return "Not indexed: " + inside + " — open it from the tree.";
		if (paletteSkipped.length === 0) return "No matches";
		// A one-file project is a real root, and "1 files" is the kind of detail a reader reads
		// as a bug in the page rather than in their tree.
		var counted = paletteTotal === 1 ? "1 file" : paletteTotal + " files";
		return "No matches in " + counted + "; " + joinNames(paletteSkipped) + " not searched.";
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
		if (result) window.location.assign(pageBase() + "/view/" + encodeSegments(result.path));
	}
	var quickOpenButton = document.getElementById("quick-open");
	if (quickOpenButton) quickOpenButton.addEventListener("click", openPalette);

	window.bfPalette = {
		open: openPalette,
		close: closePalette,
		isOpen: paletteOpen
	};`;
