/**
 * The rule a text row states: what a value must be for the row to store it.
 *
 * A rule lives beside the catalogue but not inside it, because the screen's list is sixteen
 * rows long and each row's arithmetic is one paragraph: the two together are what pushed the
 * catalogue past the module bar. Every limit here is the loader's own — the budget's clamp, the
 * WIP range, the team cap — so a value the screen accepts is a value the loader keeps, and
 * `test/settings-coverage.test.ts` holds the pair together.
 */

import { MAX_LABEL, MAX_TEAMMATES } from "../../../lib/session-label.ts";

/** What a text row accepts, checked before a write so the file cannot hold less. */
export interface TextRule {
	/** Longest accepted value, in the units the loader slices with. */
	maxLength: number;
	/** Why `raw` cannot be stored, or `undefined` when it can. */
	validate?: (raw: string) => string | undefined;
}

/**
 * A text rule for a money amount inside an inclusive range: a whole number or a
 * decimal with up to four places, matching the loader's clamp for `price.budget`.
 * `0` is a legitimate value (the guardrail is off), so it is not rejected.
 */
export function amountRule(min: number, max: number): TextRule {
	return {
		maxLength: 16,
		validate(raw) {
			const text = raw.trim();
			if (!/^\d+(?:\.\d{1,4})?$/.test(text)) return `Use an amount like 5 or 2.50, ${min} to ${max}.`;
			const value = Number(text);
			if (!Number.isFinite(value) || value < min || value > max) return `Out of range: ${min} to ${max}.`;
			return undefined;
		},
	};
}

/**
 * A text rule for a whole number inside an inclusive range: the board's two WIP limits, at the
 * `1..MAX_WIP` the loader clamps to, so the screen cannot save a number the board would shorten.
 */
export function countRule(min: number, max: number): TextRule {
	return {
		maxLength: 2,
		validate(raw) {
			const text = raw.trim();
			if (!/^\d+$/.test(text)) return `Use a whole number, ${min} to ${max}.`;
			const value = Number(text);
			if (value < min || value > max) return `Out of range: ${min} to ${max}.`;
			return undefined;
		},
	};
}

/**
 * A text rule for the team: labels, comma separated.
 *
 * The rule is the loader's, stated in the screen's words: a name is a label, so it is one line of
 * at most `MAX_LABEL` and the list holds at most `MAX_TEAMMATES`; a name stated twice is refused
 * because a team is a set. An empty list is allowed — it is how a project says its team is nobody,
 * which is what the footer draws nothing for — so the only things to refuse are a name too long
 * and a repeat.
 */
export function teammatesRule(): TextRule {
	return {
		// Every name at its longest, with the separator it would follow.
		maxLength: MAX_TEAMMATES * (MAX_LABEL + 2),
		validate(raw) {
			const names = splitList(raw);
			const long = names.find((name) => name.length > MAX_LABEL);
			if (long !== undefined) return `"${long}" is too long: a name is at most ${MAX_LABEL} characters.`;
			if (names.length > MAX_TEAMMATES) return `A team holds at most ${MAX_TEAMMATES} names.`;
			if (new Set(names).size !== names.length) return "A teammate is named twice.";
			return undefined;
		},
	};
}

/**
 * A row's list value: the comma-separated text the editor holds, as the names it states.
 *
 * Lower-cased and trimmed on the way in, because a name is addressed without case and the
 * file should read the way the vocabulary spells it.
 */
export function splitList(raw: string): string[] {
	return raw
		.split(",")
		.map((entry) => entry.trim().toLowerCase())
		.filter((entry) => entry !== "");
}
