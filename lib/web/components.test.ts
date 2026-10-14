import { describe, expect, test } from "bun:test";
import { WEB_COMPONENTS_CSS } from "./components.ts";
import { WEB_THEME_CSS } from "./tokens.ts";

/** Every custom property the theme layer defines. */
const definedTokens = new Set([...WEB_THEME_CSS.matchAll(/--[a-z0-9-]+:/g)].map((match) => match[0].slice(0, -1)));

describe("web components", () => {
	test("covers the shell primitives and their variants", () => {
		for (const selector of [
			".bf-brand{",
			".bf-mark__top{",
			".bf-btn{",
			".bf-btn--primary{",
			".bf-btn--ghost{",
			".bf-btn--icon{",
			".bf-chip--warn{",
			".bf-segmented{",
			".bf-segmented__item{",
			".bf-field{",
			".bf-panel{",
			".bf-progress__fill{",
			".bf-status--saved{",
			".bf-empty__code{",
			".bf-dialog__panel{",
		]) {
			expect(WEB_COMPONENTS_CSS).toContain(selector);
		}
	});

	test("covers the content components", () => {
		for (const selector of [
			".bf-tree__row{",
			".bf-tree__tw--toggle::after{",
			".bf-crumbs{",
			".bf-table{",
			".bf-sort{",
			".bf-card__head{",
			".bf-code__line{",
			".bf-code--numbered .bf-code__line::before{",
			".bf-media{",
			".bf-md{",
			".bf-comment{",
			".bf-composer{",
		]) {
			expect(WEB_COMPONENTS_CSS).toContain(selector);
		}
	});

	test("uses only defined custom properties", () => {
		const used = new Set([...WEB_COMPONENTS_CSS.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((match) => match[1]));
		for (const token of used) {
			expect(definedTokens.has(token), `undefined token ${token}`).toBe(true);
		}
	});

	test("keeps the Bytefly palette out of the component literals", () => {
		for (const hex of ["#0d1117", "#58a6ff", "#d29922", "#3fb950", "#f85149"]) {
			expect(WEB_COMPONENTS_CSS).not.toContain(hex);
		}
	});
});
