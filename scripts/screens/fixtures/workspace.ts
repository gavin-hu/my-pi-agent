/**
 * The invented checkout the screenshots name instead of this machine's.
 *
 * A capture prints the path it serves, so the display root is a fixture, not
 * a `cwd`: nothing in a frame may point at a real directory.
 */

/** A stand-in project path, so no capture prints this machine's own paths. */
export const DEMO_CWD = "/home/u/repo";

/** The stand-in home the footer abbreviates a checkout against. */
export const DEMO_HOME = "/home/u";

/** The stand-in checkout the hero names: a child of `DEMO_CWD`. */
export const DEMO_PROJECT = "/home/u/repo/my-pi-agent";
