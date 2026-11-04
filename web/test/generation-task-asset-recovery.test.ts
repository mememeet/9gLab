import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("completed task asset recovery preserves deletion and account isolation", () => {
    // The recovery fixture installs a browser window. Run it in a separate
    // process so modules imported during the test cannot cache that window.
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/generation-task-asset-recovery.harness.ts"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(output).toContain("0 fail");
    expect(result.exitCode, output).toBe(0);
});
