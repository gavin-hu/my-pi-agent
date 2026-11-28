/**
 * The shape check for a `watch` pattern: what makes one exponential, and the compile.
 *
 * A repeat over a group multiplies the choices inside it, and a pattern is model-authored and
 * run synchronously on the poll clock, so one line from a file nobody vouched for is what this
 * refuses before `add` starts anything. It reads the expression as text rather than asking the
 * engine, because the cost is a property of the shape and not of a match;
 * `docs/extensions/watch.md` owns what it covers and what it misses.
 */

/**
 * Refuse an expression whose work is exponential in the line it is run against.
 *
 * A repeat over a group is the shape: when an iteration can end in more than one place, the
 * outer repeat multiplies the inner choices, and one line — from a file nobody vouched for —
 * wedges the session, the poll clock included. So three things are refused, and each is a
 * measurement in `pattern.test.ts`: a body whose own tail repeats without a bound (`(a+)+`), a
 * body whose last element is optional or can match what the run before it matches
 * (`(\w+\s?)+`, `(a+a)+`), and a body whose branches can match the same text (`(a|aa)+`).
 *
 * The check reads the expression as text rather than asking the engine, because the cost is a
 * property of the shape and not of a match; the watch page's Limits owns what it misses.
 */
export function assertSafePattern(value: string, field: string): void {
	const refusal = unpinnedRepeat(value);
	if (refusal === undefined) return;
	// Nothing is rewritten for the caller, so each sentence quotes the group it means: the
	// expression as a whole can be long, and the offending repeat is what has to change.
	throw new Error(`${field} \`${value}\` repeats \`${refusal.group}\`, ${refusal.why}`);
}

/** Compile a pattern; case-insensitive unless `caseSensitive`. */
export function compileRegex(pattern: string, caseSensitive: boolean): RegExp {
	assertSafePattern(pattern, "pattern");
	return new RegExp(pattern, caseSensitive ? "" : "i");
}

/** What a quantifier does to the width of the atom before it. */
type Repeat = "none" | "nullable" | "variable";

/** The quantifier starting at `at`, as the characters it spans and the width it gives its atom. */
function repeatAt(pattern: string, at: number): { text: string; repeat: Repeat } {
	const char = pattern[at];
	if (char === "?") return { text: "?", repeat: "nullable" };
	if (char === "*" || char === "+") return { text: char, repeat: "variable" };
	if (char !== "{") return { text: "", repeat: "none" };
	const braces = /^\{(\d+)(?:(,)(\d*))?\}/.exec(pattern.slice(at));
	if (braces === null) return { text: "", repeat: "none" };
	const span = braces[0] as string;
	const lower = Number(braces[1]);
	if (braces[2] === undefined) return { text: span, repeat: lower === 0 ? "nullable" : "none" };
	if (braces[3] === "") return { text: span, repeat: "variable" };
	const upper = Number(braces[3]);
	if (upper === lower) return { text: span, repeat: upper === 0 ? "nullable" : "none" };
	return { text: span, repeat: upper <= 1 ? "nullable" : "variable" };
}

/** Whether a quantifier's text repeats without a bound: `*`, `+`, `{n,}`. */
function isUnbounded(text: string): boolean {
	return text === "*" || text === "+" || text.endsWith(",}");
}

/** One atom as written: a literal, an escape, a class, `.`, or a whole group. */
interface Atom {
	text: string;
}

/** What the overlap sample tries: every printable ASCII character. */
const SAMPLE: readonly string[] = Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index));

/**
 * Whether two atoms can match a character in common, so neither pins where the other stops.
 *
 * A sample of printable ASCII and not a proof: two classes that meet only outside it read as
 * disjoint here, which is the false negative the watch page names rather than a wrong refusal.
 */
function overlaps(left: Atom, right: Atom): boolean {
	if (left.text === right.text) return true;
	let a: RegExp;
	let b: RegExp;
	try {
		a = new RegExp(`^(?:${left.text})$`, "u");
		b = new RegExp(`^(?:${right.text})$`, "u");
	} catch {
		return true;
	}
	return SAMPLE.some((char) => a.test(char) && b.test(char));
}

/** One branch of an alternation, as the body's own scan saw it. */
interface Branch {
	/** The branch as written, comparable as text only when `plain` is true. */
	text: string;
	/** Every character a literal and no quantifier, so `(a|aa)` can be read as text. */
	plain: boolean;
	/** The branch can end its iteration more than one place, so the repeat around it is exponential. */
	loose: boolean;
}

/** A group being read, and what its body has shown so far. */
interface Frame {
	/** Where the group's `(` is, so a refusal can quote it. */
	start: number;
	/** The last element is followed by an unbounded repeat — `(a+)+`'s own shape. */
	endsUnbounded: boolean;
	/** It has an element, so the group's own `?` in `(?:` is not a quantifier. */
	hasAtom: boolean;
	/** A lookaround, which consumes nothing and so pins nothing. */
	lookaround: boolean;
	/** The variable element whose split nothing has pinned yet. */
	open: Atom | undefined;
	/** A variable element that a required atom did not pin. */
	loose: boolean;
	branches: Branch[];
	/** Where the current branch starts, and whether it is still literal text. */
	branchFrom: number;
	plain: boolean;
}

/** What a scan refuses, and why: the group to quote and the fragment of its sentence. */
interface Refusal {
	group: string;
	why: string;
}

/**
 * What each refusal says the group does, in the order a reader is likely to have meant it.
 *
 * The first is `(a+)+`: the body's own tail is an unbounded repeat. The second is an iteration
 * that can end anywhere — `(\w+\s?)` leaves `\s?` free to match nothing, and `(a+a)` ends on a
 * character its own run could have swallowed. The third is `(a|aa)`, whose branches can match
 * one text two ways.
 */
const REPEATED_TAIL =
	"whose last element already repeats without a bound — exponential in the line it runs on, so one long line can freeze the session: bound one of the two repeats, or rewrite the expression.";
const OPEN_TAIL =
	"whose iterations can end more than one place — exponential in the line it runs on, so one long line can freeze the session: end each iteration on a required character the run before it cannot match, or move the optional part outside the repeat.";
const AMBIGUOUS_BRANCHES =
	"whose branches can match the same text in more than one way — exponential in the line it runs on, so one long line can freeze the session: make the branches start differently, or drop the repeat around them.";

/**
 * The first group in `pattern` whose repeat is exponential in the line, as the text a refusal
 * quotes and the fragment that says why, or `undefined` when every repeat is pinned.
 *
 * Frames make the answer hold through nesting, so `((a+))+` is `(a+)+`. Each measurement in
 * `format.test.ts` stands for one branch of {@link unpinnedRepeat}'s report.
 */
function unpinnedRepeat(pattern: string): Refusal | undefined {
	const frameAt = (start: number, branchFrom: number): Frame => ({
		start,
		endsUnbounded: false,
		hasAtom: false,
		lookaround: isLookaround(pattern, start),
		open: undefined,
		loose: false,
		branches: [],
		branchFrom,
		plain: true,
	});
	const frames: Frame[] = [frameAt(0, 0)];
	const current = (): Frame => frames[frames.length - 1] as Frame;

	/** Take one atom and its quantifier; returns the quantifier's length. */
	const atom = (text: string, at: number, literal: boolean): number => {
		const frame = current();
		const quantifier = repeatAt(pattern, at);
		frame.hasAtom = true;
		frame.plain = frame.plain && literal && quantifier.repeat === "none";
		if (quantifier.repeat === "variable") {
			frame.endsUnbounded = isUnbounded(quantifier.text);
			frame.open = { text };
		} else if (quantifier.repeat === "nullable") {
			// `?` consumes nothing, so it neither pins the run before it nor stands in its way.
			frame.endsUnbounded = false;
		} else {
			frame.endsUnbounded = false;
			if (frame.open) {
				// A required atom is the only thing that pins a split, and one the open variable could
				// have matched itself pins nothing: `(a+a)` is that, and `(a+b)` is not.
				if (overlaps(frame.open, { text })) frame.loose = true;
				frame.open = undefined;
			}
		}
		return quantifier.text.length;
	};

	for (let i = 0; i < pattern.length; i++) {
		const char = pattern[i] as string;
		if (char === "\\") {
			i += 1 + atom(pattern.slice(i, i + 2), i + 2, false);
			continue;
		}
		if (char === "[") {
			const end = classEnd(pattern, i);
			i = end + atom(pattern.slice(i, end + 1), end + 1, false);
			continue;
		}
		if (char === "(") {
			// `(?:` is the group's own prefix, not an element of its body.
			const prefix = pattern[i + 1] === "?" && pattern[i + 2] === ":" ? 2 : 0;
			frames.push(frameAt(i, i + 1 + prefix));
			i += prefix;
			continue;
		}
		if (char === ")") {
			if (frames.length < 2) {
				// An unbalanced `)` is the engine's refusal to make, not this scan's.
				current().hasAtom = true;
				current().endsUnbounded = false;
				continue;
			}
			const closed = frames.pop() as Frame;
			closed.branches.push({
				text: pattern.slice(closed.branchFrom, i),
				plain: closed.plain,
				loose: closed.open !== undefined || closed.loose,
			});
			const group = pattern.slice(closed.start, i + 1);
			const quantifier = repeatAt(pattern, i + 1);
			if (quantifier.repeat === "variable" && isUnbounded(quantifier.text)) {
				if (closed.endsUnbounded) return { group, why: REPEATED_TAIL };
				if (closed.branches.some((branch) => branch.loose)) {
					return { group, why: closed.branches.length > 1 ? AMBIGUOUS_BRANCHES : OPEN_TAIL };
				}
				if (plainAmbiguity(closed.branches)) return { group, why: AMBIGUOUS_BRANCHES };
			}
			const parent = current();
			parent.hasAtom = true;
			parent.plain = false;
			const absorbs = closed.branches.some((branch) => branch.loose);
			if (closed.lookaround) {
				parent.endsUnbounded = false;
			} else if (quantifier.repeat === "variable" || (absorbs && quantifier.repeat === "none")) {
				// A group that can absorb a run leaves the parent's split unpinned exactly as a
				// variable atom does, which is how `((a+))+` is `(a+)+`.
				parent.open = { text: group };
				parent.endsUnbounded = quantifier.repeat === "variable" ? isUnbounded(quantifier.text) : closed.endsUnbounded;
			} else if (quantifier.repeat === "none") {
				parent.endsUnbounded = closed.endsUnbounded;
				if (parent.open) {
					if (overlaps(parent.open, { text: group })) parent.loose = true;
					parent.open = undefined;
				}
			} else {
				// `?` — the group may match nothing, so the open variable keeps its freedom.
				parent.endsUnbounded = false;
			}
			i += quantifier.text.length;
			continue;
		}
		if (char === "|") {
			const frame = current();
			frame.branches.push({
				text: pattern.slice(frame.branchFrom, i),
				plain: frame.plain,
				loose: frame.open !== undefined || frame.loose,
			});
			frame.branchFrom = i + 1;
			frame.plain = true;
			frame.open = undefined;
			frame.loose = false;
			frame.endsUnbounded = false;
			continue;
		}
		if (char === "?" || char === "*" || char === "+" || char === "{") continue;
		if (char === "^" || char === "$") {
			current().plain = false;
			continue;
		}
		i += atom(char, i + 1, true);
	}
	return undefined;
}

/**
 * Whether the branches can match one text more than one way, which is `(a|aa)`, `(ab|ab)` and
 * `(a|b|ab)` — and not `(a|ab)`, `(GET|POST)`, `(a|bb)` or `(ab|cd)`, which each have one parse.
 *
 * Only literal branches take part: a branch carrying a quantifier is `loose` and is refused by
 * its own answer, and one carrying a group is left to the sample's honesty about its reach.
 */
function plainAmbiguity(branches: readonly Branch[]): boolean {
	const units = branches.filter((branch) => branch.plain).map((branch) => branch.text);
	return units.some((word) => parses(word, units) > 1);
}

/** How many ways `word` is a non-empty sequence of `units`, counted only as far as two. */
function parses(word: string, units: readonly string[]): number {
	const ways = new Array<number>(word.length + 1).fill(0);
	ways[0] = 1;
	for (let at = 0; at < word.length; at++) {
		const waysHere = ways[at] as number;
		if (waysHere === 0) continue;
		for (const unit of units) {
			if (unit.length === 0 || !word.startsWith(unit, at)) continue;
			ways[at + unit.length] = Math.min(2, (ways[at + unit.length] as number) + waysHere);
		}
	}
	return ways[word.length] as number;
}

/** Whether the `(` at `at` opens a lookaround, which consumes nothing. */
function isLookaround(pattern: string, at: number): boolean {
	if (pattern[at + 1] !== "?") return false;
	const kind = pattern[at + 2];
	if (kind === "=" || kind === "!") return true;
	return kind === "<" && (pattern[at + 3] === "=" || pattern[at + 3] === "!");
}

/** Where the character class starting at `at` ends, or the last index when it never closes. */
function classEnd(pattern: string, at: number): number {
	for (let i = at + 1; i < pattern.length; i++) {
		if (pattern[i] === "\\") i += 1;
		else if (pattern[i] === "]") return i;
	}
	return pattern.length - 1;
}
