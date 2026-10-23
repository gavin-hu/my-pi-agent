/**
 * Structure guard for the `init` skill's question bank.
 *
 * The bank is prose the model reads: question tables whose `Shape` column names the
 * options to offer. `ask_user_question` refuses more than four options and adds its
 * own free-form escape, so an over-long list or a label spent on "Other" becomes a
 * rejected call in the middle of an interview. Both drifted once already, which is
 * why the bank states the convention in its header and this file holds it:
 * options separated by `;`, two to four of them, anything after ` — ` a note.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const root = join(import.meta.dir, "..");
const bank = readFileSync(join(root, "skills", "init", "references", "interview-questions.md"), "utf-8");

/** The cap `extensions/question/schema.ts` enforces, restated so this fails alike. */
const MAX_OPTIONS = 4;
const MIN_OPTIONS = 2;

/** A label the tool already provides, so offering it costs a real answer. */
const ESCAPE = /^(other|none of these|none|free-form)\b/i;

interface Row {
	/** The question's header, which is how the bank and the skill name it. */
	header: string;
	shape: string;
	line: number;
}

/** Question rows are the four-column tables: header, question, shape, selected when. */
function questionRows(): Row[] {
	return bank.split("\n").flatMap((text, index) => {
		if (!text.startsWith("|")) return [];
		const cells = text.split("|").map((cell) => cell.trim());
		if (cells.length !== 6) return [];
		const [, header, , shape] = cells;
		if (!header || !shape) return [];
		if (header === "Header") return [];
		if (/^-+$/.test(header) || /^-+$/.test(shape)) return [];
		return [{ header, shape, line: index + 1 }];
	});
}

/** The labels a select row offers, with the note after ` — ` removed. */
function optionsOf(shape: string): string[] {
	const listed = shape.replace(/^(Single-select|Multi-select):/, "");
	const [options] = listed.split(/\s+—\s+/);
	return options
		.split(";")
		.map((option) => option.trim())
		.filter((option) => option.length > 0);
}

describe("init question bank", () => {
	const rows = questionRows();

	test("finds the question tables", () => {
		expect(rows.length).toBeGreaterThan(10);
	});

	test("every question declares a shape this file can read", () => {
		const offenders = rows
			.filter((row) => !/^(Free-form|Single-select:|Multi-select:)/.test(row.shape))
			.map((row) => `${row.header} (line ${row.line}): ${row.shape}`);
		expect(offenders, "shape must start Free-form, Single-select:, or Multi-select:").toEqual([]);
	});

	test("every select question offers two to four options", () => {
		const offenders = rows
			.filter((row) => !row.shape.startsWith("Free-form"))
			.map((row) => ({ row, options: optionsOf(row.shape) }))
			.filter(({ options }) => options.length < MIN_OPTIONS || options.length > MAX_OPTIONS)
			.map(({ row, options }) => `${row.header} (line ${row.line}): ${options.length} options`);
		expect(offenders, `a select question offers ${MIN_OPTIONS}–${MAX_OPTIONS} options`).toEqual([]);
	});

	test("no select question spends an option on the free-form escape", () => {
		const offenders = rows
			.filter((row) => !row.shape.startsWith("Free-form"))
			.flatMap((row) => optionsOf(row.shape).map((option) => ({ row, option })))
			.filter(({ option }) => ESCAPE.test(option))
			.map(({ row, option }) => `${row.header} (line ${row.line}): ${option}`);
		expect(offenders, "the tool adds Other; never list it as an option").toEqual([]);
	});

	test("no select question repeats a label", () => {
		const offenders = rows
			.filter((row) => !row.shape.startsWith("Free-form"))
			.flatMap((row) => {
				const options = optionsOf(row.shape).map((option) => option.toLowerCase());
				const duplicates = options.filter((option, index) => options.indexOf(option) !== index);
				return duplicates.map((option) => `${row.header} (line ${row.line}): ${option}`);
			});
		expect(offenders).toEqual([]);
	});

	test("names every question the skill's default sets reference", () => {
		const headers = new Set(rows.map((row) => row.header));
		const missing = ["Verify", "Rules", "Isolation", "Priorities", "Done", "Existing file"].filter(
			(header) => !headers.has(header),
		);
		expect(missing, "a default set names a question the bank does not define").toEqual([]);
	});
});
