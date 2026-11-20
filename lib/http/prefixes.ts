/**
 * The mount prefixes two pages must name, and why they live in `lib/`.
 *
 * A served page answers under a prefix it claims from the session's server
 * (`./serve.ts`), and a claim is refused rather than re-assigned when another page
 * holds it, so a prefix is a published address: a bookmark, a redirect and a
 * cross-page link all spell it the same way, and a run-time read would only say
 * what the constant already says.
 *
 * Two extensions name each other's prefix — `code-review` links a reviewed file to
 * the browse page's file and raw views, and the browse page's diff route converges
 * onto the review page — and no extension may import another's modules, so the
 * shared names sit here, beside the layer's other boundary vocabulary
 * (`./token.ts`, `./port.ts`).
 *
 * Reached as a leaf, never through the barrel: it is two constants, while
 * `index.ts` is the whole served-page kit.
 *
 * Value-only: no imports, no module state.
 */

/** The browse page's prefix: the tree, the file pages, and the raw bytes. */
export const FILES_BASE = "/files";

/** The review page's prefix: one review page per session. */
export const REVIEW_BASE = "/review";
