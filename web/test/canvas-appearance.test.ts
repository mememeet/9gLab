import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_CANVAS_COLOR_THEME } from "../src/lib/canvas-theme";
import { setActiveUserScope } from "../src/lib/user-scope";

import {
    DEFAULT_CANVAS_BACKGROUND_MODE,
    CANVAS_APPEARANCE_PRESETS,
    canvasAppearanceForPreset,
    canvasAppearanceValues,
    switchCanvasAppearanceTheme,
    updateCustomCanvasAppearance,
    canvasAppearanceForTheme,
    customCanvasAppearanceFromTheme,
    enterCustomCanvasAppearance,
    normalizeCanvasAppearance,
    normalizeHexColor,
    readCanvasAppearanceDefault,
    resolveCanvasAppearance,
    resolveCanvasGridColor,
    writeCanvasAppearanceDefault,
} from "../src/lib/canvas/canvas-appearance";

const values = new Map<string, string>();
let originalWindow: PropertyDescriptor | undefined;

beforeEach(() => {
    originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    values.clear();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => values.get(key) || null,
                setItem: (key: string, value: string) => values.set(key, value),
                removeItem: (key: string) => values.delete(key),
            },
        },
    });
});

afterEach(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
});

describe("canvas custom appearance", () => {
    const custom = { mode: "custom" as const, custom: { baseTheme: "light" as const, backgroundColor: "#DFE9E6", backgroundBrightness: -3, gridColor: "#345678", gridOpacity: 27 } };
    test("uses point grid as the default for new canvases", () => {
        expect(DEFAULT_CANVAS_BACKGROUND_MODE).toBe("dots");
        expect(DEFAULT_CANVAS_COLOR_THEME).toBe("dark");
    });

    test("resolves the black preset to a black background and fully opaque black grid", () => {
        const appearance = canvasAppearanceForTheme(DEFAULT_CANVAS_COLOR_THEME);
        expect(resolveCanvasAppearance(appearance, "light")).toEqual({
            baseTheme: "dark",
            background: "#000000",
            grid: "#000000",
        });
        expect(resolveCanvasGridColor(appearance, "light", "dots")).toBe("#000000");
        expect(resolveCanvasAppearance(customCanvasAppearanceFromTheme("dark"), "light")).toEqual({
            baseTheme: "dark",
            background: "#000000",
            grid: "rgba(0,0,0,1)",
        });
    });

    test("selecting either fixed theme resets the spatial grid to dots", async () => {
        const source = await Bun.file(new URL("../src/components/canvas/canvas-appearance-controls.tsx", import.meta.url)).text();
        expect(source).toContain("apply(switchCanvasAppearanceTheme(draft, id)); onBackgroundModeChange(DEFAULT_CANVAS_BACKGROUND_MODE)");
        expect(resolveCanvasGridColor(canvasAppearanceForTheme("light"), "dark", "dots")).toBe("rgba(0,0,0,.80)");
    });

    test("inherits the active fixed theme the first time custom mode is selected", () => {
        const light = enterCustomCanvasAppearance(canvasAppearanceForTheme("light"), "light");
        expect(light).toMatchObject({
            mode: "custom",
            custom: {
                baseTheme: "light",
                backgroundColor: "#F0F0F0",
                backgroundBrightness: 0,
                gridColor: "#000000",
                gridOpacity: 80,
            },
        });

        const dark = enterCustomCanvasAppearance(canvasAppearanceForTheme("dark"), "dark");
        expect(dark.custom).toMatchObject({ baseTheme: "dark", backgroundColor: "#000000", backgroundBrightness: 0, gridColor: "#000000", gridOpacity: 100 });
    });

    test("restores a previous custom profile only under the same base theme", () => {
        const previous = customCanvasAppearanceFromTheme("light");
        previous.custom = { ...previous.custom!, backgroundColor: "#F3DCE5" };
        const fixedLight = canvasAppearanceForTheme("light", previous);
        expect(enterCustomCanvasAppearance(fixedLight, "light").custom).toEqual(previous.custom);

        const fixedDark = canvasAppearanceForTheme("dark", previous);
        expect(fixedDark.custom).toEqual(previous.custom);
        expect(enterCustomCanvasAppearance(fixedDark, "dark").custom).toMatchObject({
            baseTheme: "dark",
            backgroundColor: "#000000",
        });
    });

    test("keeps color-picker popups inside the appearance interaction boundary", async () => {
        const toolbarSource = await Bun.file(new URL("../src/components/canvas/canvas-toolbar.tsx", import.meta.url)).text();
        const controlsSource = await Bun.file(new URL("../src/components/canvas/canvas-appearance-controls.tsx", import.meta.url)).text();
        expect(toolbarSource).toContain('closest(".ant-color-picker,.ant-popover")');
        expect(controlsSource).toContain("if (normalized) onChange(normalized)");
    });

    test("commits custom colors immediately instead of discarding them when the panel closes", async () => {
        const controlsSource = await Bun.file(new URL("../src/components/canvas/canvas-appearance-controls.tsx", import.meta.url)).text();
        const applySource = controlsSource.slice(controlsSource.indexOf("const apply ="), controlsSource.indexOf("const selectPreset"));
        expect(applySource).toContain("onAppearanceChange(next)");
        expect(controlsSource).toContain("apply(updateCustomCanvasAppearance(draft, patch, colorTheme))");
        expect(applySource).not.toContain("onAppearancePreviewChange(next)");
    });

    test("keeps hex editing live across parent updates and common hex formats", async () => {
        expect(normalizeHexColor("F3DCE5")).toBe("#F3DCE5");
        expect(normalizeHexColor("#f3d")).toBe("#FF33DD");

        const controlsSource = await Bun.file(new URL("../src/components/canvas/canvas-appearance-controls.tsx", import.meta.url)).text();
        expect(controlsSource).toContain("if (!editing) setTextValue(value)");
        expect(controlsSource).toContain("updateCustom({ backgroundColor, backgroundBrightness: 0 })");
    });

    test("adjusts only the custom canvas substrate and grid", () => {
        const appearance = normalizeCanvasAppearance(
            {
                mode: "custom",
                custom: {
                    baseTheme: "light",
                    backgroundColor: "#F3DCE5",
                    backgroundBrightness: 0,
                    backgroundOpacity: 10,
                    gridColor: "#9D7182",
                    gridOpacity: 22,
                },
            },
            "dark",
        );

        const resolved = resolveCanvasAppearance(appearance, "dark");
        expect(resolved.baseTheme).toBe("light");
        expect(resolved.background).toBe("#F3DCE5");
        expect(resolveCanvasGridColor(appearance, "dark", "lines")).toBe("rgba(157,113,130,0.22)");

        appearance.custom!.backgroundBrightness = 10;
        const brighter = resolveCanvasAppearance(appearance, "dark").background;
        appearance.custom!.backgroundBrightness = -10;
        const darker = resolveCanvasAppearance(appearance, "dark").background;

        const brighterParts = brighter.match(/^oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)$/);
        const darkerParts = darker.match(/^oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)$/);
        expect(brighterParts).not.toBeNull();
        expect(darkerParts).not.toBeNull();
        expect(Number(brighterParts![1])).toBeGreaterThan(Number(darkerParts![1]));
        expect(brighterParts!.slice(2)).toEqual(darkerParts!.slice(2));
    });

    test("switches the custom interface style without changing custom canvas colors", () => {
        const appearance = customCanvasAppearanceFromTheme("dark");
        appearance.custom = {
            ...appearance.custom!,
            baseTheme: "light",
            backgroundColor: "#F3DCE5",
            gridColor: "#9D7182",
            gridOpacity: 22,
        };

        expect(resolveCanvasAppearance(appearance, "dark")).toEqual({
            baseTheme: "light",
            background: "#F3DCE5",
            grid: "rgba(157,113,130,0.22)",
        });
    });

    test("does not expose background opacity after legacy values are ignored", async () => {
        const controlsSource = await Bun.file(new URL("../src/components/canvas/canvas-appearance-controls.tsx", import.meta.url)).text();
        expect(controlsSource).toContain("CANVAS_APPEARANCE_PRESETS");
        expect(controlsSource).not.toContain('label="背景透明度"');
        expect(controlsSource).toContain('aria-label={t("canvasA.appearance.themeMode")}');
        expect(controlsSource).toContain('label={t("canvasA.appearance.gridOpacity")}');
    });

    test("stores defaults locally with the active account scope", () => {
        setActiveUserScope("account-A");
        const value = { appearance: customCanvasAppearanceFromTheme("dark"), backgroundMode: "lines" as const };
        writeCanvasAppearanceDefault(value);

        expect(values.has("yingce:canvas-appearance-default:user:account-A")).toBe(true);
        expect(readCanvasAppearanceDefault()).toEqual(value);

        setActiveUserScope("account-B");
        expect(readCanvasAppearanceDefault()).toBeNull();
    });

    test("editing a fixed legacy appearance starts from what is visible", () => {
        const legacy = canvasAppearanceForTheme("light", custom);
        const values = canvasAppearanceValues(legacy, "dark");
        expect(values.backgroundColor).toBe("#F0F0F0");
        expect(values.gridOpacity).toBe(80);
        expect(updateCustomCanvasAppearance(legacy, { gridOpacity: 22 }, "dark").custom).toEqual({ ...values, gridOpacity: 22 });
    });

    test("uses white for the classic light preset while retaining other swatches", () => {
        const light = CANVAS_APPEARANCE_PRESETS.filter((preset) => preset.values.baseTheme === "light");
        expect(light.map((preset) => preset.values.backgroundColor)).toEqual(["#f0f0f0", "#F3DCE5", "#EEE5D8", "#DFE9E6"]);
        expect(light.every((preset) => preset.values.gridColor === "#000000" && preset.values.gridOpacity === 23)).toBe(true);
        expect(CANVAS_APPEARANCE_PRESETS.filter((preset) => preset.values.baseTheme === "dark").map((preset) => preset.id)).toEqual(["dark", "slate"]);
    });

    test("separate light and dark fine tuning survive fixed modes, JSON reopen and repeated tone switches", () => {
        const pink = updateCustomCanvasAppearance(canvasAppearanceForPreset("pink"), { backgroundBrightness: -2, gridOpacity: 21 }, "dark");
        const slate = updateCustomCanvasAppearance(canvasAppearanceForPreset("slate", pink), { backgroundBrightness: 3, gridOpacity: 35 }, "light");
        const fixed = canvasAppearanceForTheme("light", slate);
        const reopened = normalizeCanvasAppearance(JSON.parse(JSON.stringify(fixed)), "dark");
        const light = enterCustomCanvasAppearance(reopened, "dark");
        expect(light.custom).toEqual(pink.custom);
        const dark = switchCanvasAppearanceTheme(light, "dark");
        expect(dark.custom).toEqual(slate.custom);
        expect(switchCanvasAppearanceTheme(dark, "light").custom).toEqual(pink.custom);
        expect(enterCustomCanvasAppearance(dark, "light")).toBe(dark);
    });

    test("a chosen preset survives fixed mode and reopen without silently restoring older fine tuning", () => {
        const selected = canvasAppearanceForPreset("pink", custom);
        const fixed = canvasAppearanceForTheme("dark", selected);
        const reopened = normalizeCanvasAppearance(JSON.parse(JSON.stringify(fixed)), "dark");
        const light = enterCustomCanvasAppearance(canvasAppearanceForTheme("light", reopened), "dark");
        expect(light.mode).toBe("preset");
        expect(light.preset).toEqual(selected.preset);
        expect(light.custom).toEqual(custom.custom);
        expect(resolveCanvasAppearance(light, "dark").background).toBe("#F3DCE5");
    });

    test("legacy opposite-tone custom memory is retained but never applied to the current tone", () => {
        const legacy = { mode: "preset" as const, preset: canvasAppearanceForPreset("dark").preset, custom: custom.custom };
        const normalized = normalizeCanvasAppearance(legacy, "dark");
        expect(normalized).toEqual(legacy);
        const dark = enterCustomCanvasAppearance(canvasAppearanceForTheme("dark", normalized), "light");
        expect(resolveCanvasAppearance(dark, "light").baseTheme).toBe("dark");
        expect(switchCanvasAppearanceTheme(dark, "light").custom).toEqual(custom.custom);
    });

    test("selecting the current tone is a no-op for fixed, preset and custom appearances", () => {
        const fixed = canvasAppearanceForTheme("light", custom);
        const preset = canvasAppearanceForPreset("pink", custom);
        for (const appearance of [fixed, preset, custom]) {
            expect(switchCanvasAppearanceTheme(appearance, "light")).toBe(appearance);
        }
        const dark = canvasAppearanceForTheme("dark", custom);
        expect(switchCanvasAppearanceTheme(dark, "dark")).toBe(dark);
    });

    test("a legacy fixed tone keeps its visible values and older tuning after a round trip and reopen", () => {
        for (const theme of ["light", "dark"] as const) {
            const savedCustom = updateCustomCanvasAppearance(canvasAppearanceForPreset(theme), { gridOpacity: 17 }, theme);
            const fixed = canvasAppearanceForTheme(theme, savedCustom);
            const visible = canvasAppearanceValues(fixed, theme);
            const opposite = theme === "light" ? "dark" : "light";
            const away = switchCanvasAppearanceTheme(fixed, opposite);
            const reopened = normalizeCanvasAppearance(JSON.parse(JSON.stringify(away)), opposite);
            const restored = switchCanvasAppearanceTheme(reopened, theme);
            expect(canvasAppearanceValues(restored, opposite)).toEqual(visible);
            expect(restored.custom).toEqual(savedCustom.custom);
            expect(restored.preset?.values.gridOpacity).toBe(theme === "light" ? 80 : 100);
            expect(canvasAppearanceValues(switchCanvasAppearanceTheme(restored, opposite), theme)).toEqual(canvasAppearanceValues(away, theme));
        }
    });

    test("rejects invalid and opposite-tone saved entries while retaining valid saved snapshots", () => {
        const value = { ...custom, themeMemory: { light: { mode: "preset", preset: { id: "pink", values: { ...custom.custom, backgroundColor: "#F3DCE5" } } }, dark: custom } };
        const normalized = normalizeCanvasAppearance(value, "light");
        expect(normalized.themeMemory?.dark).toBeUndefined();
        expect(normalized.themeMemory?.light?.preset?.values.backgroundColor).toBe("#F3DCE5");
        const invalid = normalizeCanvasAppearance({ ...value, themeMemory: { dark: { mode: "preset", preset: { id: "missing", values: custom.custom } } } }, "light");
        expect(invalid.themeMemory).toBeUndefined();
        expect(invalid.custom).toEqual(custom.custom);
    });
});
