import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

function canRunCodesign() {
  try {
    const r = spawnSync("codesign", ["-h"], { stdio: "ignore" });
    return r.status === 0;
  } catch {
    return false;
  }
}

function isSigned(filePath) {
  try {
    const r = spawnSync("codesign", ["-dv", "--verbose=0", filePath], { stdio: "ignore" });
    return r.status === 0;
  } catch {
    return false;
  }
}

function adhocSign(filePath) {
  try {
    const r = spawnSync("codesign", ["--force", "--sign", "-", filePath], { stdio: "ignore" });
    return r.status === 0;
  } catch {
    return false;
  }
}

function maybeCodesignRollupNative() {
  if (process.platform !== "darwin") return;
  if (!canRunCodesign()) return;

  const candidates = [
    "node_modules/@rollup/rollup-darwin-x64/rollup.darwin-x64.node",
    "node_modules/@rollup/rollup-darwin-arm64/rollup.darwin-arm64.node",
  ];

  for (const rel of candidates) {
    const filePath = path.resolve(rel);
    if (!existsSync(filePath)) continue;
    if (isSigned(filePath)) continue;
    const ok = adhocSign(filePath);
    if (!ok) {
      // Не валим установку зависимостей — это best-effort workaround для локальной macOS политики.
      // В build/test это проявится явной ошибкой, если политика запрещает и ad-hoc подпись.
      console.warn(`[postinstall] codesign failed: ${rel}`);
    }
  }
}

maybeCodesignRollupNative();

