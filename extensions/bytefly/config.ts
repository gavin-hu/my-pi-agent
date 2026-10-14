/**
 * The one JSON config file bytefly reads.
 *
 * `bytefly.json` is a single document with independent sections: the footer's
 * price calculation reads the top-level `currency` / `rates` / `peak` keys, the
 * notify capability reads `notify`, and the doctor surface reads `doctor`. Each
 * section is normalized over its own defaults by its own loader
 * (`footer/price/config.ts`, `notify/config.ts`, `doctor/config.ts`), so a
 * wrong-typed value in one section never reaches the others, and no loader has
 * to know another's schema.
 */

/** File name, looked up under the agent directory and `<cwd>/.pi`. */
export const BYTEFLY_CONFIG_FILE = "bytefly.json";
