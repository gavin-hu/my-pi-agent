/**
 * A page's class names, as a table a bundle can carry.
 *
 * A browser page in this package is a TypeScript document plus a client script held in
 * a template literal, so the two halves cannot import from each other: a class name is a
 * string in one and a string in the other, and a name built by concatenation
 * (`"board-card__reason" + kind`) cannot be found by reading either. A table fixes both:
 * the document and the bundle read the same values, and a test can compare the set the
 * page wears with the set its stylesheet draws.
 *
 * The table is emitted as one statement and interpolated into the bundle as a value, which is
 * inert: `KEBAB` guards the vocabulary itself — a class name is the stylesheet's, and a page
 * wearing one the stylesheet does not draw is a hole nothing else would find — while `IDENTIFIER`
 * guards `var <name>`, a declaration position a stray character turns into a syntax error.
 * {@link namesScript} throws rather than trusting a caller.
 */

/** A page's vocabulary: a key per thing it dresses, and the class it wears. */
export type ClassNames = Readonly<Record<string, string>>;

/** What a class name may be: lowercase, hyphenated, and nothing a script could misread. */
export const KEBAB = /^[a-z][a-z0-9_-]*$/;

/** What the global the table is bound to may be: a JavaScript identifier, and nothing else. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** The declared global the table is bound to in a page's bundle. */
const NAMES_GLOBAL = "N";

/**
 * The table as one script statement, for a client bundle to start with.
 *
 * `JSON.stringify` is the serializer because the values are already strings that pass
 * {@link KEBAB}; the check before it is what makes that true, and its message names the
 * offending key and value so the fix is obvious.
 */
export function namesScript(table: ClassNames, global: string = NAMES_GLOBAL): string {
	for (const [key, value] of Object.entries(table)) {
		if (!KEBAB.test(value)) throw new Error(`the class name for "${key}" is not a kebab-case name: "${value}"`);
	}
	if (!IDENTIFIER.test(global)) throw new Error(`"${global}" is not a name a script can declare`);
	return `var ${global} = ${JSON.stringify(table)};`;
}
