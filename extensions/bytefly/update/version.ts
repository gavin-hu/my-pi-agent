/**
 * Version comparison for the update check.
 *
 * The registry answers with whatever string the published manifest carries, so
 * both sides of the comparison are untrusted input: a payload that does not
 * parse is never an upgrade. Only the parts that decide ordering are read — the
 * numeric core and the prerelease identifiers — and build metadata is ignored,
 * as semver says it must be for precedence.
 */

/** A version split into the parts that decide precedence. */
export interface ParsedVersion {
	/** Major, minor, and patch; a missing segment is 0. */
	readonly core: readonly [number, number, number];
	/** Prerelease identifiers, empty for a release version. */
	readonly pre: readonly string[];
}

/** `[v]X[.Y[.Z]][-pre][+build]`, with no leading zeros left to interpretation. */
const VERSION_SHAPE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Whether a prerelease identifier is a dot-separated, non-empty semver identifier run. */
function isPrerelease(value: string): boolean {
	return value.split(".").every((identifier) => identifier.length > 0 && /^[0-9A-Za-z-]+$/.test(identifier));
}

/** Parse a version string, or `undefined` when it is not one. */
export function parseVersion(value: string): ParsedVersion | undefined {
	const match = VERSION_SHAPE.exec(value.trim());
	if (!match) return undefined;
	const prerelease = match[4];
	if (prerelease !== undefined && !isPrerelease(prerelease)) return undefined;
	return {
		core: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)],
		pre: prerelease === undefined ? [] : prerelease.split("."),
	};
}

/** `a`'s precedence relative to `b`: negative, zero, or positive. */
function compareCore(a: ParsedVersion, b: ParsedVersion): number {
	for (const index of [0, 1, 2] as const) {
		const difference = a.core[index] - b.core[index];
		if (difference !== 0) return difference;
	}
	return 0;
}

/**
 * Prerelease precedence, per semver: identifiers are compared left to right,
 * numeric ones numerically and below alphanumeric ones, a longer set wins over
 * its own prefix, and any prerelease sits below the release it leads to.
 */
function comparePre(a: ParsedVersion, b: ParsedVersion): number {
	if (a.pre.length === 0 || b.pre.length === 0) {
		return b.pre.length - a.pre.length;
	}
	for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index++) {
		const left = a.pre[index];
		const right = b.pre[index];
		if (left === undefined) return -1;
		if (right === undefined) return 1;
		const leftNumeric = /^\d+$/.test(left);
		const rightNumeric = /^\d+$/.test(right);
		if (leftNumeric && rightNumeric) {
			const difference = Number(left) - Number(right);
			if (difference !== 0) return difference;
			continue;
		}
		if (leftNumeric) return -1;
		if (rightNumeric) return 1;
		if (left !== right) return left < right ? -1 : 1;
	}
	return 0;
}

/** Whether `candidate` is a strictly newer version than `current`; false when either does not parse. */
export function isNewerVersion(candidate: string, current: string): boolean {
	const next = parseVersion(candidate);
	const loaded = parseVersion(current);
	if (!next || !loaded) return false;
	const core = compareCore(next, loaded);
	return core !== 0 ? core > 0 : comparePre(next, loaded) > 0;
}
