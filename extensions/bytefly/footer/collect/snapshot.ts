/**
 * Gather the data the status bar renders.
 *
 * `createSnapshotReader` memoizes the pricing scan per branch leaf, because a
 * session can hold thousands of entries and the footer renders on every frame.
 * The config is captured when the reader is built, so re-reading the file means
 * building a new reader (which is what installing the footer does).
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createPricer } from "../price/price.ts";
import type { ByteflyConfig } from "../price/types.ts";
import type { FooterData, StatusSnapshot } from "../types.ts";
import { emptyUsage, usageRecords } from "./entries.ts";

/**
 * Build a reader that memoizes the pricing scan by branch leaf.
 *
 * Every append moves the session's leaf, so `sessionId:leafId` is enough to
 * know the totals are stale; this avoids copying the full entry list per frame.
 */
export function createSnapshotReader(config: ByteflyConfig) {
	const price = createPricer(config);
	let key: string | null = null;
	let usage = emptyUsage();
	let cacheHitRate: number | null = null;

	return (ctx: ExtensionContext, footerData: FooterData): StatusSnapshot => {
		const session = ctx.sessionManager;
		const nextKey = `${session.getSessionId()}:${session.getLeafId() ?? ""}`;
		if (nextKey !== key) {
			const active = ctx.model ? { provider: ctx.model.provider, model: ctx.model.id } : undefined;
			const scanned = usageRecords(session.getEntries(), active);
			usage = price(scanned.records);
			cacheHitRate = scanned.cacheHitRate;
			key = nextKey;
		}

		const usageInfo = ctx.getContextUsage();
		const context = {
			tokens: usageInfo?.tokens ?? null,
			contextWindow: usageInfo?.contextWindow ?? ctx.model?.contextWindow ?? 0,
			percent: usageInfo?.percent ?? null,
		};

		const model = ctx.model
			? { id: ctx.model.id, provider: ctx.model.provider, reasoning: ctx.model.reasoning === true }
			: null;

		return {
			cwd: ctx.cwd,
			sessionName: ctx.sessionManager.getSessionName() ?? null,
			branch: footerData.getGitBranch(),
			statuses: footerData.getExtensionStatuses(),
			model,
			thinkingLevel: ctx.thinkingLevel ?? null,
			context,
			usage,
			currency: config.currency,
			cacheHitRate,
			providerCount: footerData.getAvailableProviderCount(),
		};
	};
}
