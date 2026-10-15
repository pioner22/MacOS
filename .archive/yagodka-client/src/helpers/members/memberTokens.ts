import type { SearchResultEntry } from "../../stores/types";
import { formatLegacyIdForInput } from "../id/legacyIdMask";

export type MemberTokenKind = "id" | "handle" | "invalid";

export interface NormalizedMemberToken {
  kind: MemberTokenKind;
  value: string;
  query: string | null;
}

function normalizeHandleCandidate(raw: string): string | null {
  const trimmed = String(raw ?? "").trim().toLowerCase();
  if (!trimmed) return null;
  const base = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  const safe = base.replace(/[^a-z0-9_]/g, "");
  if (!safe) return null;
  const handle = `@${safe}`;
  if (!/^@[a-z0-9_]{3,16}$/.test(handle)) return null;
  return handle;
}

export function normalizeMemberToken(raw: string): NormalizedMemberToken | null {
  const src = String(raw ?? "").trim();
  if (!src) return null;

  if (/^[0-9\s-]+$/.test(src)) {
    const digits = src.replace(/\D/g, "");
    // Minimum format in the project is like 123-45, i.e. 5 digits.
    if (digits.length < 5) return { kind: "invalid", value: src, query: null };
    const formatted = formatLegacyIdForInput(digits);
    return { kind: "id", value: formatted, query: formatted };
  }

  const handle = normalizeHandleCandidate(src);
  if (handle) return { kind: "handle", value: handle, query: handle };

  return { kind: "invalid", value: src, query: null };
}

export type MemberTokenStatus = "pending" | "ok" | "warn" | "bad" | "invalid";

export function statusForSearchResult(
  token: NormalizedMemberToken,
  results: SearchResultEntry[],
  targetKind: "group" | "board"
): { status: MemberTokenStatus; resolvedId?: string } {
  if (token.kind === "invalid") return { status: "invalid" };
  const requireFriend = targetKind === "group";

  if (token.kind === "id") {
    const exact = results.find((r) => r.id === token.value && !r.group && !r.board);
    if (!exact) return { status: "bad" };
    if (requireFriend && exact.friend === false) return { status: "warn" };
    return { status: "ok" };
  }

  const user = results.find((r) => r.id && !r.group && !r.board);
  if (!user) return { status: "bad" };
  if (requireFriend && user.friend === false) return { status: "warn", resolvedId: user.id };
  return { status: "ok", resolvedId: user.id };
}

