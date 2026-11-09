import { expect, test } from "bun:test";
import { placeWorkspaceOnboarding } from "../src/components/layout/use-workspace-onboarding-anchor";

test("引导卡片靠近目标并保持在可视区域", () => {
    const card = { width: 320, height: 200 };
    const viewport = { width: 500, height: 800 };
    const topTarget = { left: 20, top: 20, right: 60, bottom: 60, width: 40, height: 40 };
    const top = placeWorkspaceOnboarding(topTarget, card, viewport);
    expect(top.top >= topTarget.bottom || top.left >= topTarget.right).toBe(true);
    expect(top.left).toBeGreaterThanOrEqual(12);

    const bottomTarget = { left: 420, top: 730, right: 480, bottom: 790, width: 60, height: 60 };
    const bottom = placeWorkspaceOnboarding(bottomTarget, card, viewport);
    expect(bottom.top + card.height <= bottomTarget.top || bottom.left + card.width <= bottomTarget.left).toBe(true);
    expect(bottom.left + card.width).toBeLessThanOrEqual(viewport.width - 12);
});
