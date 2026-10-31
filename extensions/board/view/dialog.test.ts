/**
 * The card dialog: the document the client fills, and the client that fills it.
 *
 * The document carries no card text — every value the dialog shows is set from the JSON
 * frame — so what these tests read is the shape: the regions the client finds by id, the
 * order the body draws them in, and the two rules that keep it a read view.
 *
 * It is its own suite because it is its own capability: the page's suites own the board, the
 * round, and the classes the whole page shares, and this owns the one record a reader opens.
 */

import { describe, expect, test } from "bun:test";
import { boardDocument, ownRules } from "../../../test/helpers/board-document.ts";
import { BOARD_CLIENT_JS } from "./client.ts";
import { BOARD_CSS } from "./styles.ts";

/** The document as the server renders it, which is the shell the client fills. */
const page = boardDocument("board");

describe("the dialog's document", () => {
	test("carries every region the client fills, in the order a reader acts on it", () => {
		for (const id of [
			"board-card-dialog",
			"card-dialog-title",
			"card-dialog-close",
			"card-dialog-id",
			"card-dialog-where",
			// The head: the facts the card face leads with, and the lane with its age.
			"card-dialog-owner",
			"card-dialog-priority",
			"card-dialog-state",
			"card-dialog-state-label",
			"card-dialog-since",
			// One section per question, each labelled by its own heading.
			"card-dialog-contract-head",
			"card-dialog-start-head",
			"card-dialog-links-head",
			"card-dialog-record-head",
			"card-dialog-notes-head",
			"card-dialog-note-count",
			"card-dialog-updated",
			"card-dialog-landed",
			"card-dialog-reviewed",
			"card-dialog-depends",
			"card-dialog-dependents",
			"card-dialog-plan",
			"card-dialog-paths",
			"card-dialog-path-list",
			"card-dialog-notes",
			"card-dialog-no-notes",
			"card-dialog-earlier",
		]) {
			expect(page, id).toContain(`id="${id}"`);
		}
	});

	test("gives the record the shape a reader asked for", () => {
		// One scroll: the kit's dialog body. A nested notes box used to hide most of the
		// cargo behind a second scrollbar inside a 70vh panel.
		expect(BOARD_CSS).not.toContain("max-height:16rem");
		// The notes are the record, so they read at body size on a measure rather than at
		// the panel's smallest type across its whole width.
		const note = ownRules().match(/\.board-dialog__note-text\{[^}]*\}/)?.[0] ?? "";
		expect(note).toContain("--fs-base");
		expect(note).toContain("68ch");
		// A path is one line, elided, with the whole of it on the hover title.
		expect(BOARD_CSS).toContain(".board-dialog__value{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}");
		// The ladder's values start at one column in every section: the floor is the longest
		// label the ladder has, so a section of short ones lines up with the sections above it.
		expect(BOARD_CSS).toContain("grid-template-columns:minmax(6.5rem,max-content)");
	});
});

describe("the dialog's client", () => {
	test("reads one card whole: the head it came from, a section per question, and its notes", () => {
		// The lane keeps the face's word and gains the age only the lane entry can say — a note
		// moves the updated stamp without moving the card — so the dialog names a lane once.
		expect(BOARD_CLIENT_JS).toContain('getElementById("card-dialog-state-label")');
		expect(BOARD_CLIENT_JS).toContain('getElementById("card-dialog-since")');
		// The head wears the face's own priority word, from the face's own published table.
		expect(BOARD_CLIENT_JS).toContain("board.priorityClass[card.priority]");
		expect(BOARD_CLIENT_JS).toContain("board.priorityClass = PRIORITY_CLASS;");
		// Names come from the page's table, so the bundle holds the lookup, not the class.
		expect(BOARD_CLIENT_JS).toContain("N.dialogNoteFoot");
		// The rungs are written once, in the order the body draws them: a row is a name, and
		// the label and the value are found from it, so a row cannot ship with one half hidden.
		expect(BOARD_CLIENT_JS).toContain('"card-dialog-" + name + "-label"');
		expect([...BOARD_CLIENT_JS.matchAll(/setRow\("([a-z-]+)"/g)].map((match) => match[1])).toEqual([
			"goal",
			"acceptance",
			"scope-out",
			"approved",
			"plan",
			"depends",
			"dependents",
			"updated",
			"landed",
			"reviewed",
		]);
		// An empty section takes its heading with it, and the notes read newest first — with
		// one line instead of an empty list when a card has none.
		expect(BOARD_CLIENT_JS).toContain('card-dialog-" + SECTIONS[s] + "-section');
		expect(BOARD_CLIENT_JS).toContain("for (var j = card.notes.length - 1; j >= 0; j--)");
		expect(BOARD_CLIENT_JS).toContain('card.notes.length === 0 ? "" :');
		// The title is the only door: a face that drew a verb would draw a refusal.
		expect(BOARD_CLIENT_JS).toContain("board.openCard");
		expect(BOARD_CLIENT_JS).not.toContain("board-card__actions");
	});
});
