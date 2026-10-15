import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function bumpPatch(version) {
  const m = String(version || "").trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`Unsupported version format: ${version}`);
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) throw new Error(`Invalid version: ${version}`);
  return `${major}.${minor}.${patch + 1}`;
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function writeJson(filePath, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(filePath, text, "utf8");
}

function main() {
  const root = path.resolve(process.cwd());
  const packageJsonPath = path.join(root, "package.json");
  const packageLockPath = path.join(root, "package-lock.json");

  if (!fs.existsSync(packageJsonPath)) throw new Error(`Not found: ${packageJsonPath}`);
  if (!fs.existsSync(packageLockPath)) throw new Error(`Not found: ${packageLockPath}`);

  const pkg = readJson(packageJsonPath);
  const lock = readJson(packageLockPath);

  const oldVersion = String(pkg.version || "").trim();
  if (!oldVersion) throw new Error("package.json version is empty");
  const newVersion = bumpPatch(oldVersion);

  pkg.version = newVersion;
  lock.version = newVersion;
  if (lock.packages && lock.packages[""]) lock.packages[""].version = newVersion;

  writeJson(packageJsonPath, pkg);
  writeJson(packageLockPath, lock);

  process.stdout.write(`[bump_version] ${oldVersion} -> ${newVersion}\n`);
}

main();

