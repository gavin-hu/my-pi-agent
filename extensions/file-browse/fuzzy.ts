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

/** Score one path against a query; `undefined` when it is not a subsequence. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | undefined {
	if (query === "") return { score: 0, positions: [] };
	if (query.length > MAX_QUERY_LENGTH) return undefined;

	const lowerQuery = query.toLowerCase();
	const lowerText = text.toLowerCase();
	const baseStart = text.lastIndexOf("/") + 1;
	const positions: number[] = [];
	let score = 0;
	let cursor = 0;
	let previous = -2;

	for (let index = 0; index < lowerQuery.length; index++) {
		const found = lowerText.indexOf(lowerQuery[index], cursor);
		if (found === -1) return undefined;
		positions.push(found);

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
	return { score, positions };
}

/**
 * Rank `paths` against `query` and return the best `limit` matches. An empty
 * query returns nothing: the palette shows the index size instead.
 */
export function fuzzySearch(query: string, paths: readonly string[], limit: number): FuzzyResult[] {
	const trimmed = query.trim();
	if (trimmed === "" || limit <= 0) return [];
	const scored: Array<FuzzyResult & { score: number }> = [];
	for (const path of paths) {
		const match = fuzzyMatch(trimmed, path);
		if (match) scored.push({ path, positions: match.positions, score: match.score });
	}
	scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path));
	return scored.slice(0, limit).map(({ path, positions }) => ({ path, positions }));
}
