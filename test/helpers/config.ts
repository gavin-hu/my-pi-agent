/**
 * In-memory config snapshots for tests that probe a loader or a settings writer.
 */

/** A copy of `source` with the leaf at `path` set; the settings writer's shape, in memory. */
export function withLeaf(
	source: Record<string, unknown>,
	path: readonly string[],
	value: unknown,
): Record<string, unknown> {
	const [head, ...rest] = path;
	if (head === undefined) return source;
	if (rest.length === 0) return { ...source, [head]: value };
	return { ...source, [head]: withLeaf((source[head] as Record<string, unknown> | undefined) ?? {}, rest, value) };
}
