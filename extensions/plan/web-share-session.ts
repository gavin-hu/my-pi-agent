/**
 * The shared review's second listener: one reviewer token, one address on this
 * network, and the state the owner's page and `/plan share` read.
 *
 * Separate from `web.ts` because the review session's job is its own lifecycle —
 * open, settle, close — while this module owns the socket that exists only while
 * the owner has sharing on. It is handed the one request handler, the token
 * hooks, and the frame hooks, so it never reaches into the session's maps.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { bindHost, createCloser, LOOPBACK_HOSTS } from "../../lib/http/index.ts";
import { qrSvg } from "../../lib/qr.ts";
import type { ReviewFrame, ReviewRole } from "./types.ts";
import {
	lanAddresses,
	NO_SHARE_REASON,
	shareUrls,
	type NetworkInterfaces,
	type ShareResult,
	type ShareState,
} from "./web-share.ts";

/** What the share listener needs from the review session it belongs to. */
export interface ShareSessionDeps {
	/** The one request handler: a loopback page and a shared page are the same page. */
	handleRequest: (request: IncomingMessage, response: ServerResponse) => void;
	/** The owner's bound port, reused for the link when it is free. */
	ownerPort: () => number;
	/** The machine's interfaces, or a snapshot a test injected. */
	networkInterfaces: () => NetworkInterfaces;
	/** Add a reviewer token to the session's role map. */
	mintReviewer: () => string;
	/** Remove a reviewer token from the session's role map. */
	revokeReviewer: (token: string) => void;
	/** Tell the open pages something changed. */
	broadcast: (kind: ReviewFrame, only?: ReviewRole) => void;
	/** End every reviewer stream with a last frame, before the listener closes. */
	endReviewerStreams: (kind: ReviewFrame) => void;
}

/** The share surface one running review exposes. */
export interface ShareSession {
	/** Start sharing, or report why it cannot; idempotent while on. */
	share(): Promise<ShareResult>;
	/** Revoke the reviewer token, tell the reviewers, and close the listener. */
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
	let server: Server | undefined;
	let closeServer: (() => Promise<void>) | undefined;
	let reviewerToken: string | undefined;
	let state: ShareState = { sharing: false, port: 0, links: [] };
	const hosts = (): readonly string[] => (address ? [...LOOPBACK_HOSTS, address] : [...LOOPBACK_HOSTS]);

	/** Bind the shared listener on `chosen`, reusing the owner's port when it is free. */
	const bind = async (chosen: string): Promise<void> => {
		const candidate = createServer(deps.handleRequest);
		let bound: number | undefined;
		for (const attempt of [deps.ownerPort(), 0]) {
			try {
				bound = await bindHost(candidate, chosen, attempt);
				break;
			} catch {
				bound = undefined;
			}
		}
		if (bound === undefined) {
			candidate.close();
			return;
		}
		server = candidate;
		closeServer = createCloser(candidate);
		address = chosen;
		port = bound;
	};

	const share = async (): Promise<ShareResult> => {
		if (server === undefined) {
			const chosen = lanAddresses(deps.networkInterfaces())[0];
			if (chosen === undefined) {
				state = { sharing: false, port: 0, links: [], reason: NO_SHARE_REASON };
				return { state };
			}
			await bind(chosen);
			if (server === undefined) {
				state = { sharing: false, port: 0, links: [], reason: NO_SHARE_REASON };
				return { state };
			}
		}
		// One link per share: a second click re-reads it rather than minting another.
		reviewerToken ??= deps.mintReviewer();
		const links = shareUrls([address], port, reviewerToken);
		state = { sharing: true, port, links };
		deps.broadcast("share", "owner");
		return { state, svg: await qrSvg(links[0].url) };
	};

	const stop = async (): Promise<ShareResult> => {
		if (reviewerToken !== undefined) {
			deps.revokeReviewer(reviewerToken);
			reviewerToken = undefined;
		}
		// The reviewers are told before their listener goes away; the review itself
		// stays open for its owner.
		deps.endReviewerStreams("revoked");
		server = undefined;
		const closer = closeServer;
		closeServer = undefined;
		address = "";
		port = 0;
		state = { sharing: false, port: 0, links: [] };
		if (closer) await closer();
		deps.broadcast("share", "owner");
		return { state };
	};

	const close = async (): Promise<void> => {
		const closer = closeServer;
		server = undefined;
		closeServer = undefined;
		if (closer) await closer();
	};

	return { share, stop, state: () => state, hosts, close };
}
