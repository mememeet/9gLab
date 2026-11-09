import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("工作台引导和画布助手路由行为", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/workspace-onboarding.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 15000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 20000);
