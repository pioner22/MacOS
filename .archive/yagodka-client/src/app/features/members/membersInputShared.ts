export function parseMembersInput(raw: string): string[] {
  return (raw || "")
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

export function normalizeHandle(raw: string): string | null {
  const trimmed = (raw || "").trim().toLowerCase();
  if (!trimmed) return null;
  const base = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  const safe = base.replace(/[^a-z0-9_]/g, "");
  const handle = `@${safe}`;
  if (!/^@[a-z0-9_]{3,16}$/.test(handle)) return null;
  return handle;
}
