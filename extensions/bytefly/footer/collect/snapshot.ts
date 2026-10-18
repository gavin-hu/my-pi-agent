/**
 * Gather the data the status bar renders.
 *
 * `createSnapshotReader` memoizes the two scans the bar would otherwise repeat
 * on every frame: the pricing walk over the session entries, and the host's
 * context-usage estimate (which rebuilds the session projection). A session can
 * hold thousands of entries and the footer renders on every frame. The config is
 * captured when the reader is built, so re-reading the file means building a new
 * reader (which is what installing the footer does).
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createPricer } from "../price/price.ts";
import type { ByteflyConfig } from "../price/types.ts";
import type { ContextInfo, FooterData, StatusSnapshot } from "../types.ts";
import { emptyUsage, usageRecords } from "./entries.ts";

/**
 * Build a reader that memoizes both scans by branch leaf and model.
 *
 * Every append moves the session's leaf, and the context estimate depends on the
 * active model's window, so `sessionId:leafId:model` is enough to know the totals
 * are stale; this avoids copying the full entry list and rebuilding the session
 * projection per frame. Pi's own footer memoizes its stats on the same idea.
 */
export function createSnapshotReader(config: ByteflyConfig) {
	const price = createPricer(config);
	let key: string | null = null;
	let usage = emptyUsage();
	let cacheHitRate: number | null = null;
	let context: ContextInfo = { tokens: null, contextWindow: 0, percent: null };

	return (ctx: ExtensionContext, footerData: FooterData): StatusSnapshot => {
		const session = ctx.sessionManager;
		const current = ctx.model;
		const nextKey = `${session.getSessionId()}:${session.getLeafId() ?? ""}:${current?.provider ?? ""}/${current?.id ?? ""}`;
		if (nextKey !== key) {
			const active = current ? { provider: current.provider, model: current.id } : undefined;
			const scanned = usageRecords(session.getEntries(), active);
			usage = price(scanned.records);
			cacheHitRate = scanned.cacheHitRate;

			const usageInfo = ctx.getContextUsage();
			context = {
				tokens: usageInfo?.tokens ?? null,
				contextWindow: usageInfo?.contextWindow ?? current?.contextWindow ?? 0,
				percent: usageInfo?.percent ?? null,
			};
			key = nextKey;
		}

		const model = current
			? { id: current.id, provider: current.provider, reasoning: current.reasoning === true }
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
