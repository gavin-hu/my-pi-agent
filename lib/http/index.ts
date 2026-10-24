/**
 * The loopback HTTP layer shared by `file-browse` and `plan`: the response
 * shape, the header policy, the request-envelope helpers, the one server entry,
 * and the socket seam behind it.
 *
 * Import from here rather than a leaf module, so the layer reads as one kit. An
 * extension imports {@link serveLoopback} and never `./server.ts`: a hand-built
 * `node:http` server beside this one is how the close path and the idle grace
 * start to differ again.
 *
 * Value-only, like the rest of `lib/`: the only state is what a returned closure
 * carries (`createCloser`, `serveLoopback`).
 */

export * from "./headers.ts";
export * from "./response.ts";
export * from "./router.ts";
export * from "./serve.ts";
export * from "./sink.ts";
