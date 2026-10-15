import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(".");

test("changelog starts with current package version", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const changelogIndex = fs.readFileSync(path.join(root, "src/config/changelog.ts"), "utf8");
  const imports = new Map(
    [...changelogIndex.matchAll(/import\s+\{\s*(CHANGELOG_PART_\d+)\s*\}\s+from\s+"\.\/changelog\/(part\d+)";/g)].map(
      (m) => [m[1], m[2]]
    )
  );
  const firstPart = changelogIndex.match(/\.\.\.(CHANGELOG_PART_\d+)/)?.[1] || "";
  const firstPartFile = imports.get(firstPart);
  assert.ok(firstPartFile, "top changelog part not found");
  const changelog = fs.readFileSync(path.join(root, `src/config/changelog/${firstPartFile}.ts`), "utf8");
  const match = changelog.match(/ChangelogEntry\[\]\s*=\s*\[\s*\{\s*version:\s*"([^"]+)"/s);
  assert.ok(match, "top changelog version not found");
  assert.equal(match[1], pkg.version);
});
