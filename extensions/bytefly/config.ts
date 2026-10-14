/**
 * The one JSON config file bytefly reads.
 *
 * `bytefly.json` is a single document with independent sections: the footer's
 * price calculation reads the top-level `currency` / `rates` / `peak` keys, and
 * the notify capability reads `notify`. Each section is normalized over its own
 * defaults by its own loader (`footer/price/config.ts`, `notify/config.ts`), so
 * a wrong-typed value in one section never reaches the other, and neither loader
 * has to know the other's schema.
 */

/** File name, looked up under the agent directory and `<cwd>/.pi`. */
export const BYTEFLY_CONFIG_FILE = "bytefly.json";
