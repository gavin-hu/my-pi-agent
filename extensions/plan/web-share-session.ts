/**
 * The shared review's second listener: one reviewer token, one address on this
 * network, and the state the owner's page and `/plan share` read.
 *
 * Separate from `web.ts` because the review session's job is its own lifecycle —
 * open, settle, close — while this module owns the address, the links, and the
 * listener's lifetime. It is handed the one request handler, the token
 * hooks, and the frame hooks, so it never reaches into the session's maps.
 */

import { LOOPBACK_HOSTS, type LoopbackHandler, type LoopbackServer, serveLoopback } from "../../lib/http/index.ts";
import { qrSvg } from "../../lib/qr.ts";
import type { ReviewFrame, ReviewRole } from "./types.ts";
import {
	AT_CAP_REASON,
	createLinkTable,
	lanAddresses,
	NO_SHARE_REASON,
	shareUrl,
	type LinkTable,
	type NetworkInterfaces,
	type ShareResult,
	type ShareState,
} from "./web-share.ts";

/** What the share listener needs from the review session it belongs to. */
export interface ShareSessionDeps {
	/** The one request handler: a loopback page and a shared page are the same page. */
	handleRequest: LoopbackHandler;
	/** The body cap both listeners read under, so a shared page is not read differently. */
	maxBodyBytes: number;
	/** The owner's bound port, reused for the link when it is free. */
	ownerPort: () => number;
	/** The machine's interfaces, or a snapshot a test injected. */
	networkInterfaces: () => NetworkInterfaces;
	/** Add a reviewer token to the session's role map. */
	mintReviewer: () => string;
	/** Remove a reviewer token from the session's role map. */
	revokeReviewer: (token: string) => void;
	/** The name a reviewer token has bound, or undefined before its first post. */
	nameOf: (token: string) => string | undefined;
	/** Tell the open pages something changed, optionally only one role or link. */
	broadcast: (kind: ReviewFrame, only?: ReviewRole) => void;
	/** End streams with a last frame: every reviewer, or one link's. */
	endStreams: (kind: ReviewFrame, only?: { role?: ReviewRole; token?: string }) => void;
}

/** The share surface one running review exposes. */
export interface ShareSession {
	/** Start sharing with the first link, or report why it cannot; idempotent while on. */
	share(): Promise<ShareResult>;
	/** Mint one more link, so each teammate holds their own. */
	invite(): Promise<ShareResult>;
	/** Revoke one link, or undefined when this review does not hold that id. */
	revoke(id: string): Promise<ShareResult | undefined>;
	/** Revoke every link, tell the reviewers, and close the listener. */
	stop(): Promise<ShareResult>;
	/** The current state, without changing it. */
	state(): ShareState;
	/** Host names the server answers to: loopback plus the shared address. */
	hosts(): readonly string[];
	/** Close the listener as the review ends, without reading it as a decision. */
	close(): Promise<void>;
}

export function createShareSession(deps: ShareSessionDeps): ShareSession {
	let address = "";
	let port = 0;
	let server: LoopbackServer | undefined;
	const links: LinkTable = createLinkTable({
		mint: deps.mintReviewer,
		revoke: deps.revokeReviewer,
		nameOf: deps.nameOf,
	});
	let reason: string | undefined;
	const hosts = (): readonly string[] => (address ? [...LOOPBACK_HOSTS, address] : [...LOOPBACK_HOSTS]);

	/**
	 * The share surface as it is now, read rather than cached: a link's bound name
	 * changes when its reviewer posts, and the owner's page has to see that without
	 * another share action.
	 */
	const snapshot = (): ShareState => {
		const base: ShareState = server === undefined ? { sharing: false, port: 0, links: [] } : links.state(port, address);
		return reason === undefined ? base : { ...base, reason };
	};

	/** Bind the shared listener on `chosen`, reusing the owner's port when it is free. */
	const bind = async (chosen: string): Promise<void> => {
		try {
			const bound = await serveLoopback({
				host: chosen,
				ports: [deps.ownerPort(), 0],
				maxBodyBytes: deps.maxBodyBytes,
				handler: deps.handleRequest,
			});
			server = bound;
			address = chosen;
			port = bound.port;
		} catch {
			// Neither the owner's port nor a free one answered: the caller reports it.
			server = undefined;
		}
	};

	/**
	 * Bind the one shared listener the first time a link needs it, or report why
	 * there is nothing to bind to. Every link answers on this same listener, so this
	 * runs once per share and the rest is bookkeeping.
	 */
	const ensureListener = async (): Promise<boolean> => {
		if (server !== undefined) return true;
		const chosen = lanAddresses(deps.networkInterfaces())[0];
		if (chosen === undefined) {
			reason = NO_SHARE_REASON;
			return false;
		}
		await bind(chosen);
		if (server === undefined) {
			reason = NO_SHARE_REASON;
			return false;
		}
		reason = undefined;
		return true;
	};

	/** Announce the change and hand back the state, plus the QR of a link just minted. */
	const settle = async (minted?: string): Promise<ShareResult> => {
		deps.broadcast("share", "owner");
		const state = snapshot();
		if (minted === undefined) return { state };
		return { state, svg: await qrSvg(shareUrl(address, port, minted)) };
	};

	const share = async (): Promise<ShareResult> => {
		reason = undefined;
		if (!(await ensureListener())) return { state: snapshot() };
		// One link per share, so a second click re-reads the link it already minted
		// rather than making another one the owner has to revoke.
		const added = links.list().length === 0 ? links.add() : undefined;
		return settle(added?.token ?? links.list().at(-1)?.token);
	};

	const invite = async (): Promise<ShareResult> => {
		reason = undefined;
		if (!(await ensureListener())) return { state: snapshot() };
		const added = links.add();
		if (added === undefined) {
			// At the cap: the page keeps rendering the links it holds and says why.
			reason = AT_CAP_REASON;
			return { state: snapshot() };
		}
		return settle(added.token);
	};

	const revoke = async (id: string): Promise<ShareResult | undefined> => {
		reason = undefined;
		const link = links.find(id);
		if (link === undefined) return undefined;
		// The link is told before its token goes away, so its page reads the reason
		// rather than falling back to "Offline".
		deps.endStreams("revoked", { token: link.token });
		links.remove(id);
		// The last link leaving is the same thing as stopping: there is nothing left to
		// answer on the shared listener.
		if (links.list().length === 0) return stop();
		return settle();
	};

	const stop = async (): Promise<ShareResult> => {
		for (const link of links.list()) links.remove(link.id);
		// The reviewers are told before their listener goes away; the review itself
		// stays open for its owner.
		deps.endStreams("revoked", { role: "reviewer" });
		const closer = server;
		server = undefined;
		address = "";
		port = 0;
		reason = undefined;
		if (closer) await closer.close();
		return settle();
	};

	const close = async (): Promise<void> => {
		const closer = server;
		server = undefined;
		if (closer) await closer.close();
	};

	return { share, invite, revoke, stop, state: snapshot, hosts, close };
}
