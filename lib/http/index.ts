/**
 * The loopback HTTP layer shared by `file-browse` and `plan`: the response
 * shape, the header policy, the request-envelope helpers, and the socket seam.
 *
 * Import from here rather than a leaf module, so the layer reads as one kit.
 * Value-only, like the rest of `lib/`: the only state is what a returned closure
 * carries (`createCloser`).
 */

export * from "./headers.ts";
export * from "./response.ts";
export * from "./router.ts";
export * from "./server.ts";
