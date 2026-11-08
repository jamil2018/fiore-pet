import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildSite } from "./build.mjs";

test("public HTML and nested dependencies use deterministic fingerprinted assets", async () => {
  const destination = await mkdtemp(join(tmpdir(), "fiore-site-"));
  try {
    const assets = await buildSite(destination);
    const html = await readFile(join(destination, "index.html"), "utf8");
    for (const name of [
      "styles.css",
      "app.js",
      "theme.js",
      "assets/fiore-icon.svg",
    ]) {
      assert.ok(html.includes(assets[name]), name);
      assert.match(assets[name], /\.[a-f0-9]{12}\./);
      assert.ok((await readFile(join(destination, assets[name]))).length);
    }
    const css = await readFile(join(destination, assets["styles.css"]), "utf8");
    for (const name of ["assets/gestures.png", "assets/preview.png"])
      assert.ok(css.includes(assets[name]));
    const app = await readFile(join(destination, assets["app.js"]), "utf8");
    assert.ok(app.includes("./" + assets["platform.mjs"]));
    assert.deepEqual(await buildSite(destination), assets);
    assert.ok(!html.includes('href="styles.css"'));
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});
