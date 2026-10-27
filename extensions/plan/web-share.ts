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

import { lanAddresses, type NetworkInterfaces } from "../../lib/http/index.ts";

/** The interfaces a review may be shared to, by name; `lib/http` owns the rule. */
export type { NetworkInterfaces };

export { lanAddresses };

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
	/**
	 * The origin reviewers connect to, `http://192.168.1.24:4780`, or `""` when nothing is
	 * shared. The port is the listener's own, which is why it is reported with its address
	 * rather than as a number the review could have guessed.
	 */
	origin: string;
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
 * The tokenized link for one reviewer: the origin the page answers on, its mount inside
 * that origin, and the token the link carries.
 */
export function shareUrl(base: string, origin: string, token: string): string {
	return `${origin}${base}/?token=${token}`;
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
	state(base: string, origin: string, address: string): ShareState;
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
		state: (base, origin, address) => ({
			sharing: links.length > 0,
			origin,
			links: links.map((link) => {
				const name = deps.nameOf(link.token);
				return {
					id: link.id,
					address,
					url: shareUrl(base, origin, link.token),
					...(name === undefined ? {} : { name }),
				};
			}),
		}),
	};
}
