/**
 * What `/bytefly` needs once it opens, and nothing a start needs.
 *
 * The panel's listing, its prices, and the theme names are read only when the
 * command runs, so they are imported here — behind one dynamic `import()` in
 * `commands.ts` — rather than in the registration graph every entry pays on every
 * start. `test/dependencies.test.ts` names each of these in
 * `DEFERRED_FROM_REGISTRATION` with the moment it loads.
 */

export { formatListing, formatSettingsListing, SKILL_NOUN } from "./format.ts";
export { buildPanelModel, buildSkillModel, extensionName } from "./join.ts";
export { pricesReport } from "./prices.ts";
export { shippedThemeNames } from "./themes.ts";
