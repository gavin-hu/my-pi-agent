/**
 * What the suite manifest declares: which group holds which stem, and where that group's file lives.
 *
 * `test/suite-manifest.ts` owns the layout, and its `declaredSuiteFiles`/`declaredRootSuites` are the
 * paths. This module is the reader of the same file *as text*, for the one caller that has only text:
 * the landing proof reads the base's manifest out of git and the merge's from the checkout, and it
 * needs the group each declaration sat in, which no line of a diff carries (#905).
 *
 * `lib/` may not import the manifest — `package.json` ships `lib/**` and `extensions/**`, so `test/`
 * is not published — which makes `suiteFileOf` a copy of four one-line shapes the manifest also
 * spells. `extensions/board/land-hotspot.test.ts` binds the copy to the original: it reads the
 * repository's own manifest and requires this reader and resolver to reproduce `declaredSuiteFiles()`
 * and `declaredRootSuites()` exactly, so a drift on either side reddens there.
 */

/** The group that declared a suite, which is what says where its file lives. */
export type SuiteOwner = { kind: "extension"; key: string } | { kind: "lib" } | { kind: "script" } | { kind: "root" };

/** One suite a manifest declares: the stem, and the group it sits in. */
export interface DeclaredSuite {
	stem: string;
	owner: SuiteOwner;
}

/** The owner of each flat list, by the constant that holds it. */
const FLAT_GROUPS: Readonly<Record<string, SuiteOwner>> = {
	LIB_SUITES: { kind: "lib" },
	SCRIPT_SUITES: { kind: "script" },
	ROOT_SUITES: { kind: "root" },
};

/** Where a suite's file lives, one shape per owner: a copy of the manifest's, bound by `land-hotspot.test.ts`. */
export function suiteFileOf(owner: SuiteOwner, stem: string): string {
	if (owner.kind === "extension") return `extensions/${owner.key}/${stem}.test.ts`;
	if (owner.kind === "lib") return `lib/${stem}.test.ts`;
	if (owner.kind === "script") return `scripts/${stem}.test.ts`;
	return `test/${stem}.test.ts`;
}

/**
 * The declarations a manifest text makes, each with its group, with comments, brackets and strings
 * stepped over so a wrapped group reads as one that is not (#905). Read as text: the base's copy
 * exists only in git.
 *
 * `undefined` when `EXTENSION_SUITES` is missing or does not close: a reader that cannot see the
 * layout must refuse, not judge an empty set.
 */
export function declaredSuites(text: string): DeclaredSuite[] | undefined {
	const clean = withoutComments(text);
	const extensions = literalBody(clean, "EXTENSION_SUITES");
	if (extensions === undefined) return undefined;
	const groups = extensionGroups(extensions);
	if (groups === undefined) return undefined;
	const found: DeclaredSuite[] = [];
	for (const group of groups) {
		for (const stem of quotedWords(group.body)) found.push({ stem, owner: { kind: "extension", key: group.key } });
	}
	for (const [constant, owner] of Object.entries(FLAT_GROUPS)) {
		// A list the text does not declare contributes nothing; `land-hotspot.test.ts` pins the four names.
		if (!clean.includes(`export const ${constant}`)) continue;
		const body = literalBody(clean, constant);
		if (body === undefined) return undefined;
		for (const stem of quotedWords(body)) found.push({ stem, owner });
	}
	return found;
}

/**
 * The manifest with its line and block comments removed, quoted strings kept. Without it a note
 * holding an unmatched `[` ends the literal scan early — the next declaration then reads as nothing
 * and a deletion the guard exists to refuse is allowed, silently.
 */
function withoutComments(text: string): string {
	return text.replace(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (piece) =>
		piece.startsWith('"') ? piece : "",
	);
}

/** The literal a constant is assigned, without its brackets: `= { … }` or `= [ … ]`. */
function literalBody(text: string, name: string): string | undefined {
	const at = text.indexOf(`export const ${name}`);
	if (at < 0) return undefined;
	const assigned = text.indexOf("=", at);
	if (assigned < 0) return undefined;
	const open = text.slice(assigned).search(/[[{]/);
	if (open < 0) return undefined;
	const from = assigned + open;
	const close = matchingClose(text, from);
	return close === undefined ? undefined : text.slice(from + 1, close);
}

/** The index of the bracket closing the one at `from`, with quoted strings stepped over. */
function matchingClose(text: string, from: number): number | undefined {
	const opener = text[from];
	const closer = opener === "{" ? "}" : "]";
	let depth = 0;
	for (let index = from; index < text.length; index += 1) {
		const char = text[index];
		if (char === '"') {
			const end = text.indexOf('"', index + 1);
			if (end < 0) return undefined;
			index = end;
		} else if (char === opener) {
			depth += 1;
		} else if (char === closer) {
			depth -= 1;
			if (depth === 0) return index;
		}
	}
	return undefined;
}

/** Every double-quoted word in a literal body. */
function quotedWords(body: string): string[] {
	return [...body.matchAll(/"([^"]*)"/g)].map((match) => match[1] ?? "");
}

/** The `key: [ … ]` groups of `EXTENSION_SUITES`, or `undefined` when one does not close. */
function extensionGroups(body: string): Array<{ key: string; body: string }> | undefined {
	const groups: Array<{ key: string; body: string }> = [];
	const pattern = /(?:"([^"]+)"|([A-Za-z_$][\w$]*))\s*:\s*\[/g;
	let match = pattern.exec(body);
	while (match !== null) {
		const open = match.index + match[0].length - 1;
		const close = matchingClose(body, open);
		if (close === undefined) return undefined;
		groups.push({ key: match[1] ?? match[2] ?? "", body: body.slice(open + 1, close) });
		pattern.lastIndex = close;
		match = pattern.exec(body);
	}
	return groups;
}
