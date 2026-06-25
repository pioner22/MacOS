const RU_TO_EN: Record<string, string> = {
  й: "q",
  ц: "w",
  у: "e",
  к: "r",
  е: "t",
  н: "y",
  г: "u",
  ш: "i",
  щ: "o",
  з: "p",
  х: "[",
  ъ: "]",
  ф: "a",
  ы: "s",
  в: "d",
  а: "f",
  п: "g",
  р: "h",
  о: "j",
  л: "k",
  д: "l",
  ж: ";",
  э: "'",
  я: "z",
  ч: "x",
  с: "c",
  м: "v",
  и: "b",
  т: "n",
  ь: "m",
  б: ",",
  ю: ".",
  ё: "`",
};

const EN_TO_RU: Record<string, string> = Object.fromEntries(Object.entries(RU_TO_EN).map(([ru, en]) => [en, ru]));

function withUppercase(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...map };
  for (const [k, v] of Object.entries(map)) {
    const ku = k.toUpperCase();
    const vu = v.toUpperCase();
    if (!(ku in out)) out[ku] = vu;
  }
  return out;
}

const RU_TO_EN_FULL = withUppercase(RU_TO_EN);
const EN_TO_RU_FULL = withUppercase(EN_TO_RU);

export type KeyboardLayoutDirection = "ruToEn" | "enToRu";

export function mapKeyboardLayout(text: string, dir: KeyboardLayoutDirection): string {
  const src = String(text ?? "");
  if (!src) return "";
  const map = dir === "ruToEn" ? RU_TO_EN_FULL : EN_TO_RU_FULL;
  let out = "";
  for (const ch of src) out += map[ch] ?? ch;
  return out;
}

