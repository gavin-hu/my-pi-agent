/**
 * Which account this session runs the bridge for, recorded on the session branch.
 *
 * The binding is a custom entry, so it follows the active branch: a tree jump to
 * before the entry drops it, a fork keeps it, and `/resume` replays it. An
 * `account` of `null` is an explicit stop, which outranks the binding before it,
 * so a stopped session stays stopped across a resume. Only `index.ts` writes an
 * entry: it is the module that holds the extension API.
 */

/** The custom-entry type a binding is recorded under. */
export const BINDING_ENTRY = "wechat";

export interface WechatBinding {
	/** The account key the session binds (`accountKey`); `null` unbinds it. */
	account: string | null;
}

/** A full-shape check, so a stale or hand-edited entry cannot bind a session. */
function isBinding(value: unknown): value is WechatBinding {
	if (!value || typeof value !== "object") return false;
	const account = (value as Record<string, unknown>).account;
	return account === null || (typeof account === "string" && account !== "");
}

/** Record the binding on the session branch. */
export function persistBinding(
	appendEntry: (customType: string, data?: unknown) => void,
	binding: WechatBinding,
): void {
	appendEntry(BINDING_ENTRY, binding);
}

/**
 * The binding the branch carries, or undefined when nothing was ever bound.
 *
 * The last entry wins, so a stop replaces a start and a later start replaces both.
 */
export function loadBinding(branch: readonly unknown[]): WechatBinding | undefined {
	let found: WechatBinding | undefined;
	for (const entry of branch) {
		const candidate = entry as { type?: string; customType?: string; data?: unknown };
		if (candidate.type !== "custom" || candidate.customType !== BINDING_ENTRY) continue;
		if (isBinding(candidate.data)) found = candidate.data;
	}
	return found;
}
