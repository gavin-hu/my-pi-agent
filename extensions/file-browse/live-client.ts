/**
 * The live status block of the browse client script.
 *
 * It is a fragment of the same IIFE `client.ts` ships (`LIVE_CLIENT_JS` is
 * interpolated into `CLIENT_JS`), kept in its own module so the client script
 * stays one readable unit per concern. Everything it paints is text it was
 * handed — a branch name, a path, a count — so a repository cannot inject markup
 * into the page through a status frame.
 *
 * It does nothing at all unless the server rendered the connection chip, which
 * is what makes `live: false` and JS-off leave the page exactly as it was.
 */

export const LIVE_CLIENT_JS = `	// Live status: one event stream feeds the header chips, the tree and listing
	// markers, and the footer line. The server owns the cadence; this only paints.
	var liveChip = document.getElementById("live-state");
	if (liveChip) {
		var liveText = liveChip.querySelector(".browse-live__text");
		var liveLine = document.getElementById("live-status");
		var liveGit = document.querySelector(".browse-git");
		var liveChanges = document.getElementById("browse-changes");
		var liveInterval = Number(liveChip.getAttribute("data-interval")) || 3000;
		var liveReceived = 0;
		var liveTone = "";

		function formatSpan(ms) {
			var seconds = Math.max(0, Math.round(ms / 1000));
			if (seconds < 60) return seconds + "s";
			var minutes = Math.floor(seconds / 60);
			if (minutes < 60) return minutes + "m " + String(seconds % 60).padStart(2, "0") + "s";
			return Math.floor(minutes / 60) + "h " + String(minutes % 60).padStart(2, "0") + "m";
		}

		function setLiveTone(tone, label) {
			liveTone = tone;
			liveChip.className = "bf-chip browse-live" + (tone ? " bf-chip--" + tone : "");
			liveChip.hidden = false;
			if (liveText) liveText.textContent = label;
		}

		// The age is the local elapsed time since the last frame, so it stays right
		// even when the loopback server's clock and this browser's disagree. Three
		// missed frames on an open connection is a stalled feed, not a live one.
		function paintLiveAge() {
			if (!liveText || (liveTone !== "success" && liveTone !== "warn")) return;
			var idle = Date.now() - liveReceived;
			if (idle > liveInterval * 3) setLiveTone("warn", "stale \\u00B7 " + formatSpan(idle));
			else liveText.textContent = "live \\u00B7 " + formatSpan(idle);
		}

		function paintLiveGit(git) {
			if (!liveGit || !git) return;
			var name = git.branch || git.head || "";
			if (!name) return;
			var aria = git.branch ? "git branch " + git.branch : "git detached at " + git.head;
			liveGit.title = aria;
			liveGit.setAttribute("aria-label", aria);
			var glyph = liveGit.querySelector(".browse-git__glyph");
			if (glyph) glyph.textContent = git.branch ? "\\u2387" : "\\u26A0";
			var label = liveGit.querySelector(".browse-git__name");
			if (label) label.textContent = name;
		}

		function paintLiveMarks(changes) {
			var files = {};
			var dirs = {};
			((changes && changes.files) || []).forEach(function (path) { files[path] = true; });
			((changes && changes.dirs) || []).forEach(function (path) { dirs[path] = true; });
			var rows = document.querySelectorAll(".browse-listing tbody tr[data-path], nav.bf-tree .bf-tree__row[data-path]");
			Array.prototype.forEach.call(rows, function (row) {
				var path = row.getAttribute("data-path");
				var inTree = row.parentElement && row.parentElement.tagName === "LI";
				var isDir = inTree ? !!row.querySelector(".bf-tree__tw--toggle") : row.getAttribute("data-dir") === "1";
				var marked = isDir ? dirs[path] === true : files[path] === true;
				var mark = row.querySelector(".browse-change");
				if (marked && !mark) {
					mark = document.createElement("span");
					mark.className = "browse-change";
					mark.title = "uncommitted changes";
					mark.setAttribute("aria-label", "uncommitted changes");
					mark.textContent = "\\u25CF";
					var name = row.querySelector(".bf-table__name");
					(name || row).appendChild(mark);
				} else if (!marked && mark && mark.parentNode) {
					mark.parentNode.removeChild(mark);
				}
			});
		}

		function paintLiveChanges(changes) {
			var count = changes ? changes.count : 0;
			if (liveChanges) {
				liveChanges.hidden = count <= 0;
				if (count > 0) {
					var label = count + (count === 1 ? " change" : " changes");
					var totals = (changes.insertions || 0) + (changes.deletions || 0);
					liveChanges.textContent = "";
					var dot = document.createElement("span");
					dot.className = "browse-diff__dot";
					dot.setAttribute("aria-hidden", "true");
					dot.textContent = "\\u25CF";
					liveChanges.appendChild(dot);
					liveChanges.appendChild(document.createTextNode(label));
					if (totals > 0) {
						var sum = document.createElement("span");
						sum.className = "browse-diff-totals";
						var add = document.createElement("span");
						add.className = "browse-diff-add";
						add.textContent = "+" + changes.insertions;
						var del = document.createElement("span");
						del.className = "browse-diff-del";
						del.textContent = "\\u2212" + changes.deletions;
						sum.appendChild(add);
						sum.appendChild(document.createTextNode(" "));
						sum.appendChild(del);
						liveChanges.appendChild(sum);
					}
					var aria = label + " against HEAD";
					if (totals > 0) aria += ", " + changes.insertions + " insertions and " + changes.deletions + " deletions";
					liveChanges.setAttribute("aria-label", aria);
				}
			}
			paintLiveMarks(changes);
		}

		function paintLiveSnapshot(snapshot) {
			liveReceived = Date.now();
			setLiveTone("success", "live \\u00B7 0s");
			if (liveLine) {
				liveLine.hidden = false;
				var requests = Number(snapshot.requests) || 0;
				liveLine.textContent = "up " + formatSpan(Number(snapshot.uptimeMs) || 0) + " \\u00B7 " + requests + (requests === 1 ? " request" : " requests");
			}
			paintLiveGit(snapshot.git);
			paintLiveChanges(snapshot.changes);
		}

		if (window.EventSource) {
			var liveStream = new EventSource("/events");
			var liveTicker = window.setInterval(paintLiveAge, 1000);
			liveStream.addEventListener("open", function () {
				if (liveTone !== "success") setLiveTone("accent", "connecting");
			});
			liveStream.addEventListener("status", function (event) {
				var snapshot;
				try { snapshot = JSON.parse(event.data); } catch (error) { return; }
				paintLiveSnapshot(snapshot);
			});
			liveStream.addEventListener("error", function () {
				setLiveTone("danger", "offline");
			});
			window.addEventListener("pagehide", function () {
				liveStream.close();
				window.clearInterval(liveTicker);
			});
		}
	}
`;
