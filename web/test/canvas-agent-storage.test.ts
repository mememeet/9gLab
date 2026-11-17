import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("画布 Agent 对话快照按画布和账号隔离", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-agent-storage.harness.ts"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
});
