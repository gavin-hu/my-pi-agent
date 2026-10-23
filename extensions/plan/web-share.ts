/**
 * Sharing a review with the people on this network (pure).
 *
 * A shared review needs one thing the running server cannot discover for
 * itself: which address a teammate's browser should name. This module answers
 * that from an injected `networkInterfaces()` snapshot — never by reading the
 * machine's own NICs — and turns it into the links the owner is shown and the
 * page renders.
 *
 * Only addresses another machine can plausibly reach are offered: IPv4, not
 * internal, and not the link-local range a machine assigns itself when DHCP
 * failed. Everything else would print a link that cannot work.
 */

import type { NetworkInterfaceInfo } from "node:os";

/** The interfaces a review may be shared to, by name. */
export type NetworkInterfaces = Record<string, NetworkInterfaceInfo[] | undefined>;

/** One address a reviewer can open the review at. */
export interface ShareLink {
	/** The bare address, as it appears in the URL. */
	address: string;
	/** The full tokenized URL a reviewer opens. */
	url: string;
}

/** What the page and the terminal show about a running share. */
export interface ShareState {
	/** True while reviewer tokens exist and an address is bound. */
	sharing: boolean;
	/** The port reviewers connect to. */
	port: number;
	/** Every address that answers, in a stable order. */
	links: ShareLink[];
	/** Why sharing is unavailable, when it is. */
	reason?: string;
}

/** What the page gets back from a share or a stop: the state, plus a QR to render. */
export interface ShareResult {
	state: ShareState;
	/** Inline SVG for the first link; absent when nothing is shared. */
	svg?: string;
}

/** Why a machine cannot share a review. */
export const NO_SHARE_REASON =
	"This machine has no network address to share on. Reviewers can still use a loopback link on this computer.";

/**
 * IPv4 addresses another machine on this network can reach, deduplicated and
 * sorted, so the same machine prints the same link every time.
 */
export function lanAddresses(interfaces: NetworkInterfaces): string[] {
	const addresses = new Set<string>();
	for (const entries of Object.values(interfaces)) {
		for (const entry of entries ?? []) {
			if (entry.family !== "IPv4" || entry.internal) continue;
			if (entry.address === "0.0.0.0" || entry.address.startsWith("169.254.")) continue;
			addresses.add(entry.address);
		}
	}
	return [...addresses].sort(byAddress);
}

/** Numeric IPv4 comparison, so `…1.9` sorts before `…1.24`. */
function byAddress(a: string, b: string): number {
	const left = a.split(".").map(Number);
	const right = b.split(".").map(Number);
	for (let index = 0; index < 4; index++) {
		const difference = (left[index] ?? 0) - (right[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

/** The tokenized link for each address. */
export function shareUrls(addresses: readonly string[], port: number, token: string): ShareLink[] {
	return addresses.map((address) => ({
		address,
		url: `http://${address}:${port}/?token=${token}`,
	}));
}
