import * as emojiCatalogModule from "./emojiCatalog";

export type EmojiCatalogModule = typeof import("./emojiCatalog");

export { EMOJI_RECENTS_ID } from "./emojiShared";
export { insertTextAtSelection } from "./textSelection";

let emojiCatalogPromise: Promise<EmojiCatalogModule> | null = null;

export function loadEmojiCatalog(): Promise<EmojiCatalogModule> {
  if (!emojiCatalogPromise) {
    emojiCatalogPromise = Promise.resolve(emojiCatalogModule);
  }
  return emojiCatalogPromise;
}

export function updateEmojiRecents(prev: string[], emoji: string, max: number): string[] {
  const e = String(emoji || "").trim();
  if (!e) return Array.isArray(prev) ? prev : [];
  const safePrev = Array.isArray(prev) ? prev.filter((x) => typeof x === "string" && x) : [];
  const dedup = safePrev.filter((x) => x !== e);
  const next = [e, ...dedup];
  return next.slice(0, Math.max(1, Math.min(200, max || 0)));
}

export function mergeEmojiPalette(recents: string[], base: string[]): string[] {
  const r = Array.isArray(recents) ? recents.filter((x) => typeof x === "string" && x) : [];
  const b = Array.isArray(base) ? base.filter((x) => typeof x === "string" && x) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of [...r, ...b]) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}
