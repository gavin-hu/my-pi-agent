/**
 * The rule a text row states: what a value must be for the row to store it.
 *
 * A rule lives beside the catalogue but not inside it, because the screen's list is sixteen
 * rows long and each row's arithmetic is one paragraph: the two together are what pushed the
 * catalogue past the module bar. Every limit here is the loader's own — the budget's clamp, the
 * WIP range, the teammate vocabulary — so a value the screen accepts is a value the loader
 * keeps, and `test/settings-coverage.test.ts` holds the pair together.
 */

import { TEAMMATE_NAMES } from "../../../lib/session-label.ts";

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
 * A text rule for the team: the built-in teammate names, comma separated.
 *
 * The rule is the loader's, stated in the screen's words: a name the set does not hold is
 * refused rather than saved, so the file cannot name a teammate nothing can draw, and a
 * name stated twice is refused because a team is a set.
 */
export function teammatesRule(): TextRule {
	const longest = Math.max(...TEAMMATE_NAMES.map((name) => name.length));
	return {
		// Every built-in name, at its longest, with the separator it would follow.
		maxLength: TEAMMATE_NAMES.length * (longest + 2),
		validate(raw) {
			const names = splitList(raw);
			if (names.length === 0) return "Name at least one teammate, from the built-in names.";
			const unknown = names.find((name) => !TEAMMATE_NAMES.some((known) => known === name));
			if (unknown !== undefined) return `"${unknown}" is not a built-in teammate name.`;
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
