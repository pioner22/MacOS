import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function sha512Base64(filePath) {
  const hash = crypto.createHash("sha512");
  const stream = fs.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("base64")));
    stream.on("error", reject);
  });
}

async function main() {
  const root = process.cwd();
  const pkgPath = path.join(root, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const version = String(pkg.version || "").trim();
  if (!version) throw new Error("package.json version is empty");

  const desktopDist = path.join(root, "desktop-dist");
  const appPath = path.join(desktopDist, "mac", "Yagodka.app");
  if (!fs.existsSync(appPath)) throw new Error(`App bundle not found: ${appPath}`);

  const zipName = `Yagodka-${version}-mac-x64.zip`;
  const zipPath = path.join(desktopDist, zipName);
  const latestFeedPath = path.join(desktopDist, "latest-mac.yml");

  fs.rmSync(zipPath, { force: true });
  fs.rmSync(`${zipPath}.blockmap`, { force: true });

  execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, zipPath], { stdio: "inherit" });

  const stat = fs.statSync(zipPath);
  const sha512 = await sha512Base64(zipPath);
  const releaseDate = new Date().toISOString();
  const feed = [
    `version: ${version}`,
    "files:",
    `  - url: ${zipName}`,
    `    sha512: ${sha512}`,
    `    size: ${stat.size}`,
    `path: ${zipName}`,
    `sha512: ${sha512}`,
    `releaseDate: '${releaseDate}'`,
    "",
  ].join("\n");
  fs.writeFileSync(latestFeedPath, feed, "utf8");

  process.stdout.write(`[desktop-feed] zip=${zipName} size=${stat.size} version=${version}\n`);
}

main().catch((err) => {
  console.error(`[desktop-feed] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
