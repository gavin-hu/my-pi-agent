/**
 * Gather the data the status bar renders.
 *
 * `createSnapshotReader` memoizes the two scans the bar would otherwise repeat
 * on every frame: the pricing walk over the session entries, and the host's
 * context-usage estimate (which rebuilds the session projection). A session can
 * hold thousands of entries and the footer renders on every frame. The config is
 * captured when the reader is built, so re-reading the file means building a new
 * reader (which is what installing the footer does).
 *
 * The child-run ledger's version joins the memo key: a finished subagent invalidates
 * the same way an appended entry does, so the roll-up appears on the next frame
 * without re-pricing every frame.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DelegationLedger } from "../delegation.ts";
import { createPricer } from "../price/price.ts";
import type { ByteflyConfig } from "../price/types.ts";
import { zeroUsage } from "../../../../lib/usage.ts";
import type { ContextInfo, FooterData, PricedUsage, StatusSnapshot, UsageTotals } from "../types.ts";
import { usageRecords } from "./entries.ts";

/**
 * Build a reader that memoizes both scans by branch leaf and model.
 *
 * Every append moves the session's leaf, and the context estimate depends on the
 * active model's window, so `sessionId:leafId:model` is enough to know the totals
 * are stale; this avoids copying the full entry list and rebuilding the session
 * projection per frame. Pi's own footer memoizes its stats on the same idea.
 */
export interface SnapshotReader {
	/** Read a snapshot, re-pricing only when the session moved. */
	(ctx: ExtensionContext, footerData: FooterData): StatusSnapshot;
	/**
	 * The usage totals from the last read, or undefined before the first frame.
	 *
	 * The budget guardrail reads the number the footer already priced instead of
	 * walking the session a second time; if no frame has rendered yet there is
	 * nothing stale to act on. The unpriced count rides along for the same reason.
	 */
	peek(): PricedUsage | undefined;
}

/** The five counters, without the unpriced count that only the notice reads. */
function countsOf(priced: PricedUsage): UsageTotals {
	return {
		input: priced.input,
		output: priced.output,
		cacheRead: priced.cacheRead,
		cacheWrite: priced.cacheWrite,
		cost: priced.cost,
	};
}

export function createSnapshotReader(config: ByteflyConfig, delegation: DelegationLedger): SnapshotReader {
	const price = createPricer(config);
	let key: string | null = null;
	let usage: PricedUsage = { ...zeroUsage(), unpriced: 0 };
	let usageCounts: UsageTotals = zeroUsage();
	let delegationTotals = { runs: 0, usage: zeroUsage() };
	let cacheHitRate: number | null = null;
	let context: ContextInfo = { tokens: null, contextWindow: 0, percent: null };
	let sessionName: string | null = null;

	let last: PricedUsage | undefined;

	const reader = ((ctx: ExtensionContext, footerData: FooterData): StatusSnapshot => {
		const session = ctx.sessionManager;
		const current = ctx.model;
		const nextKey = `${session.getSessionId()}:${session.getLeafId() ?? ""}:${current?.provider ?? ""}/${current?.id ?? ""}:${delegation.version()}`;
		if (nextKey !== key) {
			const active = current ? { provider: current.provider, model: current.id } : undefined;
			const scanned = usageRecords(session.getEntries(), active);
			usage = price(scanned.records);
			usageCounts = countsOf(usage);
			cacheHitRate = scanned.cacheHitRate;
			// The child runs are priced by the same pricer, so a currency or rate
			// change moves both numbers together — and neither is folded into the other.
			delegationTotals = { runs: delegation.runs(), usage: countsOf(price(delegation.records())) };

			const usageInfo = ctx.getContextUsage();
			context = {
				tokens: usageInfo?.tokens ?? null,
				contextWindow: usageInfo?.contextWindow ?? current?.contextWindow ?? 0,
				percent: usageInfo?.percent ?? null,
			};
			// The host walks the file backwards for the latest `session_info`, and a
			// session renamed early makes that the whole transcript. A rename appends
			// an entry, which moves the leaf, so the memo key already covers it.
			sessionName = session.getSessionName() ?? null;
			key = nextKey;
			last = usage;
		}

		const model = current
			? { id: current.id, provider: current.provider, reasoning: current.reasoning === true }
			: null;

		return {
			cwd: ctx.cwd,
			sessionName,
			branch: footerData.getGitBranch(),
			statuses: footerData.getExtensionStatuses(),
			model,
			thinkingLevel: ctx.thinkingLevel ?? null,
			context,
			usage: usageCounts,
			currency: config.currency,
			cacheHitRate,
			providerCount: footerData.getAvailableProviderCount(),
			delegation: delegationTotals,
		};
	}) as SnapshotReader;
	reader.peek = () => last;
	return reader;
}
