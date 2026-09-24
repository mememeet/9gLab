import { describe, expect, test } from "bun:test";
import { applySkinTheme, DEFAULT_CLASSIC_SKIN, duplicateSkinDefinition, getSkinButtonAppearance, isSkinButtonFill, normalizeSkinDefinition } from "../src/lib/skin-themes";

describe("theme primary button fills", () => {
    test("9gLab classic retains solid actions and purple selection in both modes", () => {
        for (const mode of ["light", "dark"] as const) {
            const color = DEFAULT_CLASSIC_SKIN.tokens[mode];
            expect(getSkinButtonAppearance(DEFAULT_CLASSIC_SKIN, mode)).toEqual({
                background: color.primary, hover: color.primaryHover,
                active: color.primaryActive, foreground: color.primaryForeground,
            });
        }
        expect(DEFAULT_CLASSIC_SKIN.tokens.light.selected).toBe("#efefff");
    });

    test("copies have independent fills and switching to solid clears every gradient state", () => {
        const skin = duplicateSkinDefinition(DEFAULT_CLASSIC_SKIN, ["classic"]);
        skin.tokens.buttons.light.mode = "gradient";
        skin.tokens.buttons.light.angle = 45;
        skin.tokens.buttons.light.start = "#123456";
        expect(DEFAULT_CLASSIC_SKIN.tokens.buttons.light.angle).toBe(115);
        expect(skin.tokens.buttons.dark.angle).toBe(115);
        expect(getSkinButtonAppearance(skin, "light").background).toBe("linear-gradient(45deg, #123456, #386fbc)");
        const values = new Map<string, string>();
        const doc = { documentElement: { dataset: {}, style: {
            removeProperty: (key: string) => values.delete(key), setProperty: (key: string, value: string) => values.set(key, value),
        } } } as unknown as Document;
        applySkinTheme(skin, "light", doc);
        skin.tokens.buttons.light.mode = "solid";
        Object.assign(skin.tokens.light, { primary: "#123456", primaryHover: "#234567", primaryActive: "#345678", primaryForeground: "#ffffff" });
        applySkinTheme(skin, "light", doc);
        expect(values.get("--button-primary-bg")).toBe("#123456");
        expect(values.get("--button-primary-hover-bg")).toBe("#234567");
        expect(values.get("--button-primary-active-bg")).toBe("#345678");
        applySkinTheme(DEFAULT_CLASSIC_SKIN, "dark", doc);
        expect(values.get("--background")).toBe("#111113");
        expect(values.get("--button-primary-fg")).toBe("#18181b");
    });

    test("legacy custom and 9gLab classic themes retain solid actions", () => {
        for (const original of [DEFAULT_CLASSIC_SKIN, duplicateSkinDefinition(DEFAULT_CLASSIC_SKIN, ["classic"])]) {
            const legacy = JSON.parse(JSON.stringify(original));
            delete legacy.tokens.buttons;
            expect(normalizeSkinDefinition(legacy).tokens.buttons.light.mode).toBe("solid");
        }
    });

    test("invalid modes, angles and CSS injection cannot become runtime gradients", () => {
        for (const patch of [{ mode: "url(x)" }, { angle: 361 }, { angle: -1 }, { angle: 1.5 }, { angle: NaN }, { start: "red; background:url(x)" }, { foreground: "white" }]) {
            const skin = duplicateSkinDefinition(DEFAULT_CLASSIC_SKIN, ["classic"]);
            Object.assign(skin.tokens.buttons.light, patch);
            expect(isSkinButtonFill(skin.tokens.buttons.light)).toBe(false);
            expect(getSkinButtonAppearance(normalizeSkinDefinition(skin), "light").background).toBe(skin.tokens.light.primary);
        }
    });
});
