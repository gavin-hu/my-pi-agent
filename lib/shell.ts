/**
 * Shell escape rule shared by the worktree isolation guard and plan mode's
 * read-only git guard.
 *
 * A backslash escapes the character after it. For guarding, only a meaningful
 * set matters: whitespace, quotes, another backslash, and shell metacharacters
 * (`;`, `&`, `|`, `<`, `>`, `(`, `)`, `{`, `}`, `[`, `]`, `$`, and the
 * backtick). A backslash before anything else is a literal separator, so a
 * Windows path (`C:\Users\x`) survives; that distinction is the whole point of
 * this module, and it is why the rule lives in one place rather than in two
 * guards that can drift.
 *
 * Value-only: a constant and pure functions, no module state. The regex is not
 * global, so `.test` never mutates `lastIndex`.
 */

/** Characters a backslash escapes in a shell, for guard purposes. */
export const SHELL_ESCAPABLE = /[\s"'\\$`;&|<>(){}[\]]/;

/** Whether a preceding backslash escapes the single character `next`. */
export function isShellEscapable(next: string): boolean {
	return SHELL_ESCAPABLE.test(next);
}

/** Whether `command` contains a backslash escape, including a trailing backslash. */
export function hasShellEscape(command: string): boolean {
	for (let i = 0; i < command.length; i++) {
		if (command[i] !== "\\") continue;
		const next = command[i + 1];
		if (next === undefined || isShellEscapable(next)) return true;
	}
	return false;
}
