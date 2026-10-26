/**
 * Filesystem reads for the browse extension: classification, listing, tree, and index.
 *
 * Four jobs that a caller wants as one surface, so they are four modules behind this
 * barrel rather than one 551-line module named after none of them. All paths are absolute
 * and already vetted by `paths.ts`; nothing here touches the raw request URL.
 */

export * from "./classify.ts";
export * from "./index.ts";
export * from "./list.ts";
export * from "./tree.ts";
