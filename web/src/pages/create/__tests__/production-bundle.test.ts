import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const execFileAsync = promisify(execFile);
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const outputRoot = mkdtempSync(resolve(tmpdir(), "9glab-create-bundle-"));

after(() => {
    rmSync(outputRoot, { recursive: true, force: true });
});

test("production bundling keeps Motion reorder components initialized", { timeout: 120_000 }, async () => {
    await execFileAsync(
        "bunx",
        ["vite", "build", "--mode", "development", "--minify", "false", "--sourcemap", "false", "--outDir", outputRoot],
        { cwd: webRoot },
    );

    const createChunk = readdirSync(resolve(outputRoot, "assets")).find((name) => /^create-.*\.js$/.test(name));
    assert.ok(createChunk, "the creation page chunk should be emitted");
    const bundleSource = readFileSync(resolve(outputRoot, "assets", createChunk), "utf8");

    assert.doesNotMatch(bundleSource, /var ReorderGroup, ReorderItem;/);
    assert.match(bundleSource, /init_Group\(\);/);
    assert.match(bundleSource, /init_Item\(\);/);
});
