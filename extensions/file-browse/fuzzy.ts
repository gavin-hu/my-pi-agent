/**
 * Fuzzy path matching for the quick-open palette.
 *
 * A query matches when its characters appear in order in the path
 * (case-insensitive). The score rewards matches on the basename and at
 * path-segment starts, contiguous runs, earlier positions, and exact case, and
 * penalizes gaps, so a match on `readme.ts` outranks one spread through a
 * parent directory. The matched character positions are returned so the client
 * can highlight them; the palette never sees HTML.
 *
 * The palette runs this on every keystroke over an index of thousands of paths,
 * so ranking keeps only the best `limit` candidates instead of sorting them all:
 * the highlighted columns are computed for those winners and no others.
 *
 * Pure and dependency-free so it can be unit-tested without a DOM.
 */

export interface FuzzyMatch {
	score: number;
	positions: number[];
}

export interface FuzzyResult {
	path: string;
	positions: number[];
}

/** Queries longer than this are treated as no match. */
const MAX_QUERY_LENGTH = 256;

/** A candidate while it is still unranked: a path and its score. */
interface Candidate {
	path: string;
	score: number;
}

/** A scan's result; `positions` is collected only when the caller asked for it. */
interface Scan {
	score: number;
	positions?: number[];
}

/**
 * The one subsequence scan. `collect` fills the matched columns, which the
 * ranking pass does not need and allocates an array for on every candidate.
 */
function scan(query: string, text: string, collect: boolean): Scan | undefined {
	if (query === "") return collect ? { score: 0, positions: [] } : { score: 0 };
	if (query.length > MAX_QUERY_LENGTH) return undefined;

	const lowerQuery = query.toLowerCase();
	const lowerText = text.toLowerCase();
	const baseStart = text.lastIndexOf("/") + 1;
	const positions: number[] | undefined = collect ? [] : undefined;
	let score = 0;
	let cursor = 0;
	let previous = -2;

	for (let index = 0; index < lowerQuery.length; index++) {
		const found = lowerText.indexOf(lowerQuery[index], cursor);
		if (found === -1) return undefined;
		positions?.push(found);

		let bonus = 1;
		if (text[found] === query[index]) bonus += 1;
		if (found === previous + 1) bonus += 5;
		if (found === 0 || text[found - 1] === "/") bonus += 6;
		if (found >= baseStart) bonus += 3;
		if (previous >= 0) {
			const gap = found - previous - 1;
			if (gap > 0) bonus -= gap > 8 ? 8 : gap;
		}
		score += bonus;
		previous = found;
		cursor = found + 1;
	}
	return positions ? { score, positions } : { score };
}

/** Score one path against a query; `undefined` when it is not a subsequence. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | undefined {
	const scanned = scan(query, text, true);
	return scanned ? { score: scanned.score, positions: scanned.positions ?? [] } : undefined;
}

/**
 * The palette's one total order: the higher score first, then the shorter path
 * (a basename match beats a name buried in a directory), then the path itself so
 * two candidates never compare equal.
 */
function compare(a: Candidate, b: Candidate): number {
	if (a.score !== b.score) return b.score - a.score;
	if (a.path.length !== b.path.length) return a.path.length - b.path.length;
	return a.path.localeCompare(b.path);
}

/** Keep `candidate` in `window` — sorted by {@link compare}, never longer than `limit`. */
function keepBest(window: Candidate[], candidate: Candidate, limit: number): void {
	let low = 0;
	let high = window.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if (compare(window[middle], candidate) <= 0) low = middle + 1;
		else high = middle;
	}
	if (low >= limit) return;
	window.splice(low, 0, candidate);
	if (window.length > limit) window.pop();
}

/**
 * Rank `paths` against `query` and return the best `limit` matches. An empty
 * query returns nothing: the palette shows the index size instead.
 *
 * The result is the same list a full sort would produce — `keepBest` inserts on
 * the same order — but the work is bounded by `limit` rather than by the index,
 * and the matched columns are computed for the winners only.
 */
export function fuzzySearch(query: string, paths: readonly string[], limit: number): FuzzyResult[] {
	const trimmed = query.trim();
	if (trimmed === "" || limit <= 0) return [];
	const window: Candidate[] = [];
	for (const path of paths) {
		const scored = scan(trimmed, path, false);
		if (scored === undefined) continue;
		keepBest(window, { path, score: scored.score }, limit);
	}
	return window.map(({ path }) => ({ path, positions: fuzzyMatch(trimmed, path)?.positions ?? [] }));
}
