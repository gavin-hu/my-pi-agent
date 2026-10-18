/**
 * Reduce session entries to the usage records the price calculation needs.
 *
 * One record is one usage-bearing entry, resolved to the model in effect: an
 * assistant call and a usage entry name their own provider and model, while a
 * tool result or a generated summary inherits the model of the call it belongs
 * to. The cache hit rate comes from the latest assistant record, mirroring Pi's
 * built-in footer.
 */

import type { UsageRecord, UsageTotals } from "../types.ts";

interface UsageLike {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost?: { total?: number };
}

interface MessageLike {
	role?: string;
	provider?: unknown;
	model?: unknown;
	usage?: Partial<UsageLike>;
	timestamp?: unknown;
}

interface EntryLike {
	type?: string;
	provider?: unknown;
	model?: unknown;
	modelId?: unknown;
	usage?: Partial<UsageLike>;
	timestamp?: unknown;
	message?: MessageLike;
}

interface UsageSource {
	usage: Partial<UsageLike>;
	/** The object naming the model, when the entry has one of its own. */
	owner?: EntryLike | MessageLike;
	isAssistant: boolean;
}

/** Zeroed totals; the starting point for every accumulation. */
export function emptyUsage(): UsageTotals {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, recordedCost: 0 };
}

/**
 * Every usage-bearing entry, as a record.
 *
 * `active` is the model the session is on, used for an entry whose history does
 * not say. A `model_change` entry, and an assistant call that names its model,
 * both move the model in effect for the entries that follow.
 */
export function usageRecords(
	entries: Iterable<unknown>,
	active: { provider: string; model: string } | undefined,
): { records: UsageRecord[]; cacheHitRate: number | null } {
	const records: UsageRecord[] = [];
	let cacheHitRate: number | null = null;
	let current = active;

	for (const raw of entries) {
		const entry = raw as EntryLike;

		if (entry?.type === "model_change") {
			current = namedModel(entry.provider, entry.modelId) ?? current;
			continue;
		}

		const source = usageSource(entry);
		if (!source) continue;

		const own = namedModel(source.owner?.provider, source.owner?.model);
		if (source.isAssistant && own) current = own;

		const input = source.usage.input ?? 0;
		const output = source.usage.output ?? 0;
		const cacheRead = source.usage.cacheRead ?? 0;
		const cacheWrite = source.usage.cacheWrite ?? 0;

		records.push({
			provider: own?.provider ?? current?.provider ?? null,
			model: own?.model ?? current?.model ?? null,
			input,
			output,
			cacheRead,
			cacheWrite,
			recordedCost: source.usage.cost?.total ?? 0,
			at: timestampOf(entry),
			isAssistant: source.isAssistant,
		});

		if (source.isAssistant) {
			const prompt = input + cacheRead + cacheWrite;
			cacheHitRate = prompt > 0 ? (cacheRead / prompt) * 100 : null;
		}
	}

	return { records, cacheHitRate };
}

/** A provider and model, only when both are named. */
function namedModel(provider: unknown, model: unknown): { provider: string; model: string } | null {
	if (typeof provider !== "string" || !provider) return null;
	if (typeof model !== "string" || !model) return null;
	return { provider, model };
}

/** The usage an entry contributes, and whether it names a model of its own. */
function usageSource(entry: EntryLike): UsageSource | null {
	if (entry.type === "usage") {
		return entry.usage ? { usage: entry.usage, owner: entry, isAssistant: false } : null;
	}
	if (entry.type === "compaction" || entry.type === "branch_summary") {
		return entry.usage ? { usage: entry.usage, isAssistant: false } : null;
	}
	if (entry.type !== "message") return null;
	const message = entry.message;
	if (!message?.usage) return null;
	if (message.role === "assistant") return { usage: message.usage, owner: message, isAssistant: true };
	if (message.role === "toolResult") return { usage: message.usage, isAssistant: false };
	return null;
}

/** The entry's own ISO timestamp, else the message's epoch-millisecond one. */
function timestampOf(entry: EntryLike): number | null {
	if (typeof entry.timestamp === "string") {
		const parsed = Date.parse(entry.timestamp);
		if (Number.isFinite(parsed)) return parsed;
	}
	const message = entry.message?.timestamp;
	return typeof message === "number" && Number.isFinite(message) ? message : null;
}
