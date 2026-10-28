/**
 * The shipped review client, read as source: the routes it posts to, the draft it
 * keeps, the stream it holds open, and the `safeHref` the page actually evaluates.
 */

import { describe, expect, test } from "bun:test";
import { clientFunction, linkFor } from "../../test/helpers/fixtures/plan-web.ts";
import { REVIEW_CLIENT_JS } from "./web-client.ts";
import {
	approveReview,
	cancelReview,
	postReviewComments,
	saveReview,
	submitAnnotations,
	WEB_SETTLE_JS,
} from "./web-settle.ts";
describe("review client", () => {
	test("parses as JavaScript", () => {
		expect(() => new Function(REVIEW_CLIENT_JS)).not.toThrow();
	});

	test("has no external URLs beyond the autolink scheme", () => {
		const withoutScheme = REVIEW_CLIENT_JS.replace('"http://" + url', "");
		expect(withoutScheme).not.toContain("http://");
		expect(REVIEW_CLIENT_JS).not.toContain("https://");
		expect(REVIEW_CLIENT_JS).not.toContain("//cdn");
	});

	test("uses only same-origin routes with the session token", () => {
		// Every route a settlement writes to is in one module now; the stream stays in the
		// bundle, because it is wiring rather than a rule.
		expect(WEB_SETTLE_JS).toContain('deps.base() + "/api/feedback"');
		expect(WEB_SETTLE_JS).toContain('deps.base() + "/api/comment"');
		expect(WEB_SETTLE_JS).toContain('deps.base() + "/api/approve"');
		expect(WEB_SETTLE_JS).toContain('deps.base() + "/api/cancel?token="');
		expect(WEB_SETTLE_JS).toContain('"?token=" + encodeURIComponent(deps.token())');
		expect(REVIEW_CLIENT_JS).toContain("/events?token=");
	});

	test("a reviewer's post keeps the page live and an owner's save settles it", () => {
		// The two are read apart because the difference is which flags they touch: posting
		// is transient, saving ends the review.
		const post = String(postReviewComments);
		expect(post).toContain('deps.base() + "/api/comment"');
		expect(post).not.toContain("markSettled");
		expect(post).not.toContain("settleStream");
		expect(post).not.toContain("lockActions");

		const save = String(saveReview);
		expect(save).toContain('deps.base() + "/api/feedback"');
		expect(save).toContain('deps.markSettled("saved")');
		expect(String(approveReview)).toContain('deps.markSettled("approved")');
	});

	test("shows the server's own reason when a post conflicts", () => {
		// A 409 is either a plan that moved or a link already bound to a name; the
		// server's sentence says which, so the page must not assume the first.
		const submit = String(submitAnnotations);
		expect(submit).toContain("function submitAnnotations(");
		// The parsed body carries the server's sentence, so a conflict says which of the two
		// it was rather than always the plan-changed one.
		expect(submit).toContain("body.error");
		expect(submit).toContain("deps.offerReload()");
		expect(submit).toContain("deps.planMoved");
		// The plan-changed sentence is the fallback now, not the only thing said.
		expect(submit).not.toContain('setStatus("The plan changed');
	});

	test("puts the tab stop back after it rebuilds the block it was in", () => {
		// Focus is restored only when the reviewer's own action destroyed it, never on
		// a repaint the stream caused, and the status region says what happened.
		// The rule is web-plan.ts's now: focus comes back only when it was inside the plan.
		expect(REVIEW_CLIENT_JS).toContain(
			"const keepFocus = !!(deps.focused && deps.focused !== planEl && planEl.contains(deps.focused));",
		);
		expect(REVIEW_CLIENT_JS).toContain('active.querySelector(".bf-block__add")');
		expect(REVIEW_CLIENT_JS).toContain("Comment added.");
		expect(REVIEW_CLIENT_JS).toContain("Comment updated.");
	});

	test("keys its unsaved draft on the plan revision and this tab", () => {
		// A draft is this tab's own work for this plan text: never another writer's,
		// and never restored onto a plan that changed underneath it.
		expect(REVIEW_CLIENT_JS).toContain('var DRAFT_KEY = "bf-review-draft"');
		expect(REVIEW_CLIENT_JS).toContain("window.sessionStorage.setItem(DRAFT_KEY");
		expect(REVIEW_CLIENT_JS).toContain('draft.rev !== String(data.rev || "")');
		expect(REVIEW_CLIENT_JS).toContain("var mine = annotations.filter(isMine);");
		expect(REVIEW_CLIENT_JS).toContain("var restoredTyping = restoreDraft();");
	});

	test("keeps a half-typed comment in the same draft record", () => {
		// The composer's text is not a comment yet, so it is the draft's second half:
		// written on every keystroke, dropped when the composer closes, and reopened
		// with its caret at the end after a reload.
		expect(clientFunction("typingOf")).toContain('area.closest(".bf-block")');
		expect(clientFunction("saveDraft")).toContain("record.typing = typing");
		expect(clientFunction("openComposer")).toContain('area.addEventListener("input"');
		expect(clientFunction("reopenComposer")).toContain("blockAtLine(deps.planEl, blocks, typing.anchor)");
		expect(clientFunction("restoreDraft")).toContain("return typing;");
		// A close with nothing open must not rewrite, and so drop, a restored draft.
		const close = clientFunction("closeComposer");
		expect(close).toContain("if (open)");
		expect(close).toContain("deps.saveDraft();");
		expect(REVIEW_CLIENT_JS).toContain("function closeOpenComposer() {");
	});

	test("keeps the selection a composer was quoting", () => {
		// The text alone restores a different note: the quote is what the comment is
		// about, so the chip's value travels with the draft and comes back on reopen.
		expect(clientFunction("openComposer")).toContain('composer.setAttribute("data-quote", quote)');
		expect(clientFunction("typingOf")).toContain('composer.getAttribute("data-quote")');
		expect(clientFunction("restoreDraft")).toContain('quote: typeof stored.quote === "string"');
		expect(clientFunction("reopenComposer")).toContain('typing.quote || ""');
	});

	test("closes the review only for its owner and reads a terminal frame", () => {
		expect(String(cancelReview)).toContain('deps.role() !== "owner" || deps.settled()');
		// The terminal frames the bundle reads off the stream.
		expect(REVIEW_CLIENT_JS).toContain('kind === "closed"');
		expect(REVIEW_CLIENT_JS).toContain('kind === "revoked"');
		expect(String(submitAnnotations)).toContain("buttons.post.disabled = !0");
	});

	test("never assigns plan or comment text as markup", () => {
		expect(REVIEW_CLIENT_JS).not.toContain("innerHTML");
		expect(REVIEW_CLIENT_JS).toContain(".textContent =");
	});

	test("opens the approval confirmation instead of posting on the keypress", () => {
		expect(REVIEW_CLIENT_JS).toContain('getElementById("approve-dialog")');
		expect(REVIEW_CLIENT_JS).toContain('getElementById("approve-confirm")');
		expect(REVIEW_CLIENT_JS).toContain("window.bfApprove.open()");
		expect(REVIEW_CLIENT_JS).toContain("askApprove()");
	});

	test("refuses to leave a draft, hides empty steps, and offers a delete back", () => {
		// The rule is `web-draft.ts`'s now: the client keeps its sentence and its status
		// line, and hands both to the one guard.
		expect(REVIEW_CLIENT_JS).toContain("guardDraft(planEl, statusEl, DRAFT_REFUSAL, paintStatus)");
		expect(REVIEW_CLIENT_JS).toContain("Add or discard the comment you are writing.");
		expect(REVIEW_CLIENT_JS).toContain('getElementById("step-fact")');
		expect(REVIEW_CLIENT_JS).toContain('button.id = "undo-delete"');
		expect(REVIEW_CLIENT_JS).toContain("function removeComment(index)");
	});

	test("leaves the shortcut sheet's Esc to the shared dialog runtime", () => {
		// One copy of the close: the kit's capture listener owns it, so the page
		// keymap cannot drift from the sheet's own behavior.
		expect(REVIEW_CLIENT_JS).not.toContain("window.bfKeys.close()");
	});

	test("rejects a protocol-relative link", () => {
		expect(linkFor("//evil.com")).toBeNull();
	});

	test("refuses a link that is only cross-origin after URL parsing", () => {
		// trim keeps an interior tab, and the URL parser deletes it: without
		// resolving first, "/\t/evil.com" reads as a same-origin path.
		expect(linkFor("/\t/evil.com")).toBeNull();
		expect(linkFor("/\n/x.com")).toBeNull();
	});

	test("refuses a non-web scheme and a credentialed URL", () => {
		for (const target of ["javascript:alert(1)", "data:text/html,x", "https://user:pw@example.com/x"]) {
			expect(linkFor(target)).toBeNull();
		}
	});

	test("keeps web, mail, anchor, and same-origin relative links", () => {
		expect(linkFor("https://example.com/x")).toBe("https://example.com/x");
		expect(linkFor("mailto:a@b.example")).toBe("mailto:a@b.example");
		expect(linkFor("#section")).toBe("http://127.0.0.1:1234/?token=t#section");
		expect(linkFor("docs/x.md")).toBe("http://127.0.0.1:1234/docs/x.md");
	});

	test("keeps a stream open so the server sees the tab close", () => {
		expect(REVIEW_CLIENT_JS).toContain("new EventSource(");
		// A closed tab is a dropped stream the server times out; a beacon would also
		// cancel the review on a reload, which the 409 path offers on purpose.
		expect(REVIEW_CLIENT_JS).not.toContain("sendBeacon");
		expect(REVIEW_CLIENT_JS).not.toContain("beforeunload");
	});

	test("closes the stream once the review has settled", () => {
		expect(REVIEW_CLIENT_JS).toContain("function settleStream()");
		expect(REVIEW_CLIENT_JS).toContain("stream.close()");
		expect(REVIEW_CLIENT_JS).toContain('addEventListener("pagehide", settleStream)');
	});

	test("offers a reload when the plan changed on disk", () => {
		expect(REVIEW_CLIENT_JS).toContain("result.status === 409");
		expect(REVIEW_CLIENT_JS).toContain("window.location.reload()");
	});

	test("takes its caps from the island instead of retyping them", () => {
		expect(REVIEW_CLIENT_JS).toContain("var limits = data.limits || fallback.limits;");
		expect(REVIEW_CLIENT_JS).toContain("area.maxLength = limits.comment;");
		expect(REVIEW_CLIENT_JS).toContain("annotations.length >= limits.comments");
		expect(REVIEW_CLIENT_JS).toContain("slice(0, limits.quote)");
		expect(REVIEW_CLIENT_JS).not.toContain(">= 200");
	});

	test("mints and revokes single links from the owner's dialog", () => {
		expect(REVIEW_CLIENT_JS).toContain('shareAction(pageBase() + "/api/share/link"');
		expect(REVIEW_CLIENT_JS).toContain('shareAction(pageBase() + "/api/share/revoke", { id: id }');
		expect(REVIEW_CLIENT_JS).toContain("shareLinksEl.appendChild(row)");
		// A row's name is the bound one, so the owner can tell two links apart.
		expect(REVIEW_CLIENT_JS).toContain('"@" + link.name');
	});

	test("settles on a terminal state instead of Offline", () => {
		expect(REVIEW_CLIENT_JS).toContain('label = "Approved"');
		expect(REVIEW_CLIENT_JS).toContain('label = "Saved"');
		expect(REVIEW_CLIENT_JS).toContain('label = "Closed"');
		expect(REVIEW_CLIENT_JS).toContain("} else if (everConnected) {");
		expect(REVIEW_CLIENT_JS).toContain("everConnected = true");
	});

	test("shows the server's own reason when a save is rejected", () => {
		expect(REVIEW_CLIENT_JS).toContain("payload.error");
		expect(REVIEW_CLIENT_JS).toContain("response.json()");
	});

	test("ignores Enter while an IME composition is open", () => {
		expect(REVIEW_CLIENT_JS).toContain("event.isComposing");
	});

	test("marks a changed outline section with a labelled dot", () => {
		expect(REVIEW_CLIENT_JS).toContain('"review-changed"');
		expect(REVIEW_CLIENT_JS).toContain("Changed since your last review");
		expect(REVIEW_CLIENT_JS).toContain("item.changed");
	});
});
