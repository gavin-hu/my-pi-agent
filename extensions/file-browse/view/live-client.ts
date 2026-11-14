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
 * is what makes `live: false` and JS-off leave the page exactly as it was. What a
 * state *says* is this page's; the states themselves, and the retry count that
 * turns one into the next, are the shared stream client's.
 *
 * The folder check is the other half: the stream is shared by every open page, so
 * it cannot say what *this* page's rows show. A page that lists a folder carries
 * the revision of what it drew, and asks the server for the folder's current one
 * once per interval; a difference reveals a reload control instead of touching
 * the document, because a reload is the only honest way to add a row.
 */

export const LIVE_CLIENT_JS = `	// Live status: one event stream feeds the header chips, the tree and listing
	// markers. The server owns the cadence; this only paints.
	var liveChip = document.getElementById("live-state");
	if (liveChip) {
		var liveGit = document.querySelector(".browse-git");
		var liveChanges = document.getElementById("browse-changes");
		var liveInterval = Number(liveChip.getAttribute("data-interval")) || 5000;
		var liveStale = 0;
		/** The state the shared stream client reported, and the tone painted for it. */
		var liveState = "connecting";
		var liveRev = "";
		var liveDir = liveChip.getAttribute("data-dir");
		var liveDirRev = liveChip.getAttribute("data-rev");
		var liveReload = document.getElementById("reload-hint");
		var liveDirTimer = 0;
		/** The stream's own accounting of itself, which the chip's hover carries. */
		var liveServer = "";

		function formatSpan(ms) {
			var seconds = Math.max(0, Math.round(ms / 1000));
			if (seconds < 60) return seconds + "s";
			var minutes = Math.floor(seconds / 60);
			if (minutes < 60) return minutes + "m " + String(seconds % 60).padStart(2, "0") + "s";
			return Math.floor(minutes / 60) + "h " + String(minutes % 60).padStart(2, "0") + "m";
		}

		/**
		 * The chip's hover, for the word it is wearing: what it means, and what a reader can do
		 * about it.
		 *
		 * The footer carries the page's facts, so the server's uptime and request count are read
		 * here — the chip is the one place the stream speaks about itself. A state a reader can
		 * act on says so, because a word like "offline" with no remedy is a dead end.
		 */
		// The page's half of the shared states is the hover: what a reader can do about this one.
		// The words themselves are the kit's, so no page can drift onto its own.
		function liveTitle(state) {
			if (state === "dead") return "The server stopped — restart /browse, then reload";
			if (state === "reconnecting") return "The stream dropped — this page is stale until it reconnects";
			if (state === "live") return liveServer || "Live status from the browse server";
			return "Waiting for the browse server";
		}

		// The page's fifth word, which is no stream state: a live connection that has gone quiet.
		var STALE_TITLE = "No frame in three intervals — this page may be stale";

		// The four states the shared client reports, painted through the kit's one table. A stream
		// that dropped is a page that may be stale, not one that has stopped being true, so only the
		// spent retries — dead — are where this page offers its one action.
		function liveWords(state) {
			liveState = state;
			if (state === "live") {
				paintLiveState(liveChip, state, "", liveTitle(state));
				armLiveStale();
				return;
			}
			window.clearTimeout(liveStale);
			paintLiveState(liveChip, state, "", liveTitle(state));
			if (state === "dead") showLiveReload();
		}

		// The chip names its state and never counts: nothing is repainted between
		// frames, and the uptime is the chip's hover to report. Three missed frames on an
		// open connection is a stalled feed, not a live one, so one timeout is armed per
		// frame instead of a second-by-second tick.
		function armLiveStale() {
			window.clearTimeout(liveStale);
			liveStale = window.setTimeout(function () {
				if (liveState === "live") paintLive(liveChip, "warn", "stale", STALE_TITLE);
			}, liveInterval * 3);
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

		// One revision covers the chip and the markers: a frame that did not move the
		// change set is not painted at all, so a tick on an idle tree costs no DOM
		// work however many rows the page drew.
		function paintLiveChanges(changes) {
			if (changes && changes.rev === liveRev) return;
			liveRev = changes && changes.rev ? changes.rev : "";
			var count = changes ? changes.count : 0;
			if (liveChanges) {
				liveChanges.hidden = count <= 0;
				if (count > 0) {
					var label = count + (count === 1 ? " change" : " changes");
					var totals = (changes.insertions || 0) + (changes.deletions || 0);
					liveChanges.textContent = "";
					var dot = document.createElement("span");
					dot.className = "browse-changes__dot";
					dot.setAttribute("aria-hidden", "true");
					dot.textContent = "\\u25CF";
					liveChanges.appendChild(dot);
					liveChanges.appendChild(document.createTextNode(label));
					if (totals > 0) {
						var sum = document.createElement("span");
						sum.className = "browse-changes__totals";
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
			var requests = Number(snapshot.requests) || 0;
			liveServer =
				"up " + formatSpan(Number(snapshot.uptimeMs) || 0) + " \u00B7 " + requests +
				(requests === 1 ? " request" : " requests");
			paintLiveState("live", "success", "live");
			armLiveStale();
			paintLiveGit(snapshot.git);
			paintLiveChanges(snapshot.changes);
		}

		// The folder the page drew, checked against the disk on the frame cadence. It
		// waits for the first frame, never runs in a hidden tab, and stops as soon as
		// it has something to say: the control is the fix, and a reload ends the
		// question.
		function showLiveReload() {
			window.clearInterval(liveDirTimer);
			liveDirTimer = 0;
			if (!liveReload || !liveReload.hidden) return;
			liveReload.hidden = false;
			liveReload.addEventListener("click", function () { window.location.reload(); });
		}

		function checkLiveDir() {
			if (document.hidden || liveState !== "live") return;
			fetch(pageBase() + "/api/dir-rev?path=" + encodeURIComponent(liveDir))
				.then(function (response) {
					if (!response.ok) throw new Error("check failed");
					return response.json();
				})
				.then(function (answer) {
					var rev = answer.rev;
					if (typeof rev === "string" && rev !== liveDirRev) showLiveReload();
				})
				.catch(function () { /* the stream already reports a dead server */ });
		}

		// The stream: one state machine for every served page, in this page's words. A root
		// that moved under this page is the one frame it cannot paint — the document it drew
		// belongs to the tree the session left — so that frame reloads, as the folder check does.
		// This page mints no token — it answers on the loopback socket and is never shared — so
		// it says so, and the shared client's pagehide close ends the stream as the page leaves.
		liveStream({
			url: pageBase() + "/events",
			token: undefined,
			events: ["status", "moved"],
			words: liveWords,
			frame: function (event) {
				if (event.type === "moved") {
					window.location.reload();
					return;
				}
				var snapshot;
				try { snapshot = JSON.parse(event.data); } catch (error) { return; }
				paintLiveSnapshot(snapshot);
			}
		});
		window.addEventListener("pagehide", function () {
			window.clearTimeout(liveStale);
			window.clearInterval(liveDirTimer);
		});
		if (liveDir !== null && liveDirRev && liveReload) {
			liveDirTimer = window.setInterval(checkLiveDir, liveInterval);
		}
	}
`;
