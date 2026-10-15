export interface BuildIdParts {
  version: string;
  build: string | null;
}

export function splitBuildId(raw: unknown): BuildIdParts {
  const s = String(raw ?? "").trim();
  if (!s) return { version: "", build: null };
  const m = s.match(/^(.*)-([a-f0-9]{12})$/i);
  if (!m) return { version: s, build: null };
  return { version: m[1], build: m[2].toLowerCase() };
}

