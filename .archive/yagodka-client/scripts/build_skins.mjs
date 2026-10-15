import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const skinsDir = path.join(distDir, "skins");

const SKIN_ID_RE = /^[a-z0-9_-]{1,32}$/;
const TITLE_MAP = {
  default: "По умолчанию",
  "yagodka-modern": "Yagodka Modern",
  "telegram-web": "Ягодка (светлая)",
  "telegram-exact": "Telegram (точный)",
  "dark-premium": "Тёмная премиум",
  "light-mode": "Светлая тема",
  "desktop-version": "Десктопная версия",
  "gradient-accent": "Градиентный акцент",
  "cyberberry-crt": "Cyberberry CRT",
  showcase: "Showcase",
  amber: "Amber",
  green: "Green",
};

function titleFromId(id) {
  return String(id)
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function listSkins() {
  const out = [];
  let items = [];
  try {
    items = await fs.readdir(skinsDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const it of items) {
    if (!it.isFile()) continue;
    if (!it.name.endsWith(".css")) continue;
    const id = it.name.slice(0, -".css".length).toLowerCase();
    if (!SKIN_ID_RE.test(id)) continue;
    const title = TITLE_MAP[id] || titleFromId(id);
    out.push({ id, title });
  }
  out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

async function main() {
  await fs.mkdir(skinsDir, { recursive: true });
  const skins = await listSkins();
  const payload = { skins };
  await fs.writeFile(path.join(skinsDir, "skins.json"), JSON.stringify(payload, null, 2) + "\n", "utf8");
  // eslint-disable-next-line no-console
  console.log(`[skins] skins.json generated (skins=${skins.length})`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(String(e?.stack || e));
  process.exit(2);
});
