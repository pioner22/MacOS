import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

test("skins: не переопределяют .hidden (ломает лейаут/скролл)", async () => {
  const dir = path.resolve("public/skins");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".css"));
  assert.ok(files.length > 0, "no skins found");

  for (const name of files) {
    const css = await readFile(path.join(dir, name), "utf8");
    assert.doesNotMatch(css, /\.hidden\b/, `skin ${name} must not reference .hidden`);
  }
});

