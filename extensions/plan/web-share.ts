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
	/** Stable for the life of this review and never reused, so a page can name one link. */
	id: string;
	/** The bare address, as it appears in the URL. */
	address: string;
	/** The full tokenized URL a reviewer opens. */
	url: string;
	/** The name this link posts under, once its first post has bound it. */
	name?: string;
}

/** What the page and the terminal show about a running share. */
export interface ShareState {
	/** True while reviewer tokens exist and an address is bound. */
	sharing: boolean;
	/** The port reviewers connect to. */
	port: number;
	/** Every shared link, oldest first. */
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

/** The tokenized link for one address. */
export function shareUrl(address: string, port: number, token: string): string {
	return `http://${address}:${port}/?token=${token}`;
}

/**
 * One link is one person.
 *
 * A shared review holds one reviewer token per link, and the token is the only
 * credential a reviewer has: it names the role, and it binds the name the link
 * posts under on its first write. Two people on one link are one writer, so the
 * table exists to let the owner hand out as many as the team has members — and to
 * take one back without touching the others.
 */

/** The most links one review may hold: each is a live bearer credential. */
export const MAX_SHARE_LINKS = 8;

/** Why another link cannot be minted: every link is a live credential. */
export const AT_CAP_REASON = `This review already holds ${MAX_SHARE_LINKS} links; revoke one before minting another.`;

/** One share the table holds: the id a page names it by, and its token. */
export interface SharedLink {
	/** Stable for the life of the review, and never reused after a revoke. */
	id: string;
	/** The reviewer token this link carries. */
	token: string;
}

/** What the table needs from the review that owns the tokens. */
export interface LinkTableDeps {
	/** Mint a reviewer token. */
	mint: () => string;
	/** Release a token, so the link that carried it stops answering. */
	revoke: (token: string) => void;
	/** The name a link's token has bound, so the owner can see who holds it. */
	nameOf: (token: string) => string | undefined;
}

/** The reviewer links one running review has shared. */
export interface LinkTable {
	/** Mint a link on a fresh token, or nothing when the review is at the cap. */
	add(): SharedLink | undefined;
	/** The link with this id, or nothing when the review does not hold it. */
	find(id: string): SharedLink | undefined;
	/** Release one link by id; false when the review does not hold it. */
	remove(id: string): boolean;
	/** The links currently shared, oldest first. */
	list(): readonly SharedLink[];
	/** The state the owner's page and the terminal read. */
	state(port: number, address: string): ShareState;
}

export function createLinkTable(deps: LinkTableDeps): LinkTable {
	const links: SharedLink[] = [];
	let minted = 0;
	return {
		add() {
			if (links.length >= MAX_SHARE_LINKS) return undefined;
			minted += 1;
			const link: SharedLink = { id: `link-${minted}`, token: deps.mint() };
			links.push(link);
			return link;
		},
		find: (id) => links.find((link) => link.id === id),
		remove(id) {
			const index = links.findIndex((link) => link.id === id);
			if (index < 0) return false;
			const [removed] = links.splice(index, 1);
			if (removed) deps.revoke(removed.token);
			return true;
		},
		list: () => [...links],
		state: (port, address) => ({
			sharing: links.length > 0,
			port,
			links: links.map((link) => {
				const name = deps.nameOf(link.token);
				return {
					id: link.id,
					address,
					url: shareUrl(address, port, link.token),
					...(name === undefined ? {} : { name }),
				};
			}),
		}),
	};
}
