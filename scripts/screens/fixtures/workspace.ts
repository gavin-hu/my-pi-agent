/**
 * The invented checkout the screenshots name instead of this machine's.
 *
 * A capture prints the path it serves, so the display root is a fixture, not
 * a `cwd`: nothing in a frame may point at a real directory.
 */

/** A stand-in project path, so no capture prints this machine's own paths. */
export const DEMO_CWD = "/home/u/repo";
