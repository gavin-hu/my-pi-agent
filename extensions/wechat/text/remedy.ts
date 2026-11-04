/**
 * The remedy every notice names, in one place: the step that is actually missing.
 *
 * A login stores an account and starts nothing, so it is never the whole answer
 * to "the bridge is not here" — a start is, and a login only comes first when no
 * account is stored.
 */

/** The step that opens a bridge on a session that already has a stored account. */
export const START_REMEDY = "Run /wechat start first.";

/** Both steps, for a session with no stored account: a login stores, a start polls. */
export const LOGIN_THEN_START = "Run /wechat login, then /wechat start.";

/** The same recovery as a clause, for the one-line status. */
export const EXPIRY_RECOVERY = " — run /wechat login, then /wechat start";

/** The step a session is missing for the bridge it asked for. */
export function bridgeRemedy(hasAccount: boolean): string {
	return hasAccount ? START_REMEDY : LOGIN_THEN_START;
}
