/**
 * The review page's settlement: the four ways a review ends, and the one POST they share.
 *
 * The eighth capability out of the review client's template literal. Every write has the
 * same shape — POST the annotations, read the answer, report it in the status line — and
 * what differs is whether the review settles: the owner's save and approve finish it, a
 * reviewer's post does not (the server keeps the review open so she can keep editing), and
 * cancel is the owner's own decision and carries no body at all.
 *
 * The page owns its flags, its buttons, and its stream; this module owns the rules about
 * them, so it reads through getters and reports changes through the callbacks it is given.
 */

/** What a settlement reads of the page, and the changes it reports. */
export interface SettleDeps {
	/** The path a write goes to, without its query string. */
	token(): string;
	role(): string;
	/** The comments this writer may write: her own when she is a reviewer, all when owner. */
	mine(): readonly { author?: string }[];
	annotations(): readonly { author?: string }[];
	/** Whether the review has already ended, by any of the three routes. */
	settled(): boolean;
	setStatus(text: string, kind?: string): void;
	/** The three buttons a conflict disables, and the fourth a close does. */
	buttons(): {
		approve: { disabled: boolean } | null;
		save: { disabled: boolean } | null;
		post: { disabled: boolean } | null;
	};
	/** The draft this tab's work lives in: cleared once the server has it. */
	clearDraft(): void;
	/** The page is no longer dirty: the server has everything this tab wrote. */
	markClean(): void;
	/** The server bound this reviewer's name to her link: adopt it. */
	adoptName(name: string): void;
	/** Put a reload button beside the controls: the page cannot recover on its own. */
	offerReload(): void;
	/** Record how the review ended, stop following it, and stop offering to change it. */
	markSettled(kind: "saved" | "approved" | "closed"): void;
	settleStream(): void;
	lockActions(): void;
	/** Repaint the header chip and the facts. */
	updateState(): void;
	/** Refuse to leave a half-written comment, saying why. */
	confirmNoDraft(): boolean;
	post(url: string, body: unknown): Promise<{ ok: boolean; status: number; body: unknown }>;
	/** A body-less POST, for the close that carries nothing. */
	send(url: string): Promise<unknown>;
	/** What a body-less conflict says, when the server gave no sentence of its own. */
	planMoved: string;
}

/** What a settlement reports back: the flag it set, and whether the page is finished. */
export interface SettleResult {
	outcome: "ok" | "conflict" | "failed";
	reason?: string;
}

/**
 * POST the annotations, and read the answer on both branches.
 *
 * A 409 disables the three write buttons and offers a reload, because the page's island is
 * out of date and no retry from here can fix that; anything else surfaces the server's own
 * sentence, which is why the body is parsed on both branches rather than only on success.
 */
export function submitAnnotations(
	deps: SettleDeps,
	url: string,
	okText: string,
	failText: string,
	onOk: (() => void) | null,
): Promise<SettleResult> {
	const payload = deps.role() === "reviewer" ? deps.mine() : deps.annotations();
	return deps
		.post(url + "?token=" + encodeURIComponent(deps.token()), { annotations: payload })
		.then((result) => {
			if (result.ok) {
				deps.markClean();
				deps.clearDraft();
				deps.setStatus(okText, "saved");
				if (onOk) onOk();
				deps.updateState();
				// The server binds a reviewer's name to her link on the first post, so a
				// second tab of the same link posts under the same name — and it may normalise
				// what she typed (`@alice` is stored as `alice`). The comments she just posted
				// are in the file under the bound name, so the page's copy has to say that too:
				// otherwise they stop being hers to edit, and her next post would replace
				// markers it never sent.
				const body = result.body as { author?: unknown } | null;
				if (deps.role() === "reviewer" && body && typeof body.author === "string" && body.author) {
					for (const annotation of payload) if (annotation.author !== undefined) annotation.author = body.author;
					deps.adoptName(body.author);
				}
				return { outcome: "ok" as const };
			}
			if (result.status === 409) {
				const buttons = deps.buttons();
				if (buttons.approve) buttons.approve.disabled = true;
				if (buttons.save) buttons.save.disabled = true;
				if (buttons.post) buttons.post.disabled = true;
				deps.offerReload();
				const body = result.body as { error?: unknown } | null;
				const reason = body && typeof body.error === "string" ? body.error : deps.planMoved;
				deps.setStatus(reason, "error");
				return { outcome: "conflict" as const, reason };
			}
			const body = result.body as { error?: unknown } | null;
			throw new Error(body && typeof body.error === "string" ? body.error : "server returned " + result.status);
		})
		.catch((error: { message?: string }) => {
			const reason = failText + (error && error.message ? error.message : "");
			deps.setStatus(reason, "error");
			return { outcome: "failed" as const, reason };
		});
}

/** Save the annotations and finish the review: the owner's way to close an approved plan. */
export function saveReview(deps: SettleDeps): Promise<SettleResult> | null {
	if (deps.settled()) return null;
	if (deps.confirmNoDraft()) return null;
	deps.setStatus("Saving\u2026");
	return submitAnnotations(
		deps,
		"/api/feedback",
		"Saved \u2014 return to Pi to continue.",
		"Could not save: ",
		function () {
			deps.markSettled("saved");
			deps.settleStream();
			deps.lockActions();
		},
	);
}

/**
 * Post a reviewer's comments and keep the review open.
 *
 * A reviewer's write never settles the page: the server keeps the review open so she can
 * keep editing her own comments, and closing the stream here would strand her.
 */
export function postReviewComments(deps: SettleDeps): Promise<SettleResult> | null {
	if (deps.settled()) return null;
	if (deps.confirmNoDraft()) return null;
	deps.setStatus("Posting\u2026");
	return submitAnnotations(
		deps,
		"/api/comment",
		"Comments posted \u2014 the owner sees them now.",
		"Could not post: ",
		null,
	);
}

/** Approve the plan, which finishes the review. */
export function approveReview(deps: SettleDeps): Promise<SettleResult> | null {
	if (deps.settled()) return null;
	deps.setStatus("Approving\u2026");
	return submitAnnotations(
		deps,
		"/api/approve",
		"Approved \u2014 return to Pi to continue.",
		"Could not approve: ",
		function () {
			deps.markSettled("approved");
			deps.settleStream();
			deps.lockActions();
		},
	);
}

/**
 * Close the review without saving: only the owner may, and the page says so while it asks.
 *
 * The close carries no body, so it is the one write that does not go through
 * `submitAnnotations`; its answer is a status line either way, because a tab that closed the
 * review has nothing left to do with a failure.
 */
export function cancelReview(deps: SettleDeps): Promise<void> | null {
	if (deps.role() !== "owner" || deps.settled()) return null;
	if (deps.confirmNoDraft()) return null;
	deps.markSettled("closed");
	deps.settleStream();
	deps.lockActions();
	deps.setStatus("Closing\u2026");
	deps.updateState();
	return deps
		.send("/api/cancel?token=" + encodeURIComponent(deps.token()))
		.catch(function () {})
		.then(function () {
			deps.setStatus("Closed \u2014 return to Pi.");
			deps.updateState();
		});
}

/** The settlement rules as source, for the client bundle. */
export const WEB_SETTLE_JS = [submitAnnotations, saveReview, postReviewComments, approveReview, cancelReview]
	.map(String)
	.join("\n\n");
