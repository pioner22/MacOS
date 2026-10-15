import { mapKeyboardLayout } from "./keyboardLayout";

export type ServerSearchKind = "handle" | "id" | "room_id";

export type ServerSearchDerivation = {
  query: string;
  kind: ServerSearchKind;
};

const HANDLE_RE = /^@[a-z0-9_]{3,16}$/;
const ROOM_ID_RE = /^(?:grp-|b-)[a-z0-9-]{0,64}$/i;

function normalizeHandleCandidate(raw: string): string | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  const base = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  // Reject obvious non-handle patterns to avoid turning "grp-" into "@grp".
  if (!trimmed.startsWith("@") && /[-\s]/.test(base)) return null;
  // Numeric-only queries are almost always user IDs, not handles.
  if (!trimmed.startsWith("@") && /^[0-9]+$/.test(base)) return null;
  const safe = base.toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (!safe) return null;
  const handle = `@${safe}`;
  if (!HANDLE_RE.test(handle)) return null;
  return handle;
}

function normalizeRoomIdCandidate(raw: string): string | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (!ROOM_ID_RE.test(lower)) return null;
  if (lower.length < 3) return null;
  return lower;
}

function hasCyrillic(text: string): boolean {
  return /[а-яё]/i.test(text);
}

export function deriveServerSearchQuery(raw: string): ServerSearchDerivation | null {
  const qRaw = String(raw ?? "").trim();
  if (!qRaw) return null;
  const q = qRaw.length > 256 ? qRaw.slice(0, 256) : qRaw;

  // Room ids are a separate namespace, preserve "-" (server searches id substring).
  const roomId = normalizeRoomIdCandidate(q);
  if (roomId) return { query: roomId, kind: "room_id" };

  // Handle search (with or without leading "@").
  let handle = normalizeHandleCandidate(q);
  if (!handle && q.startsWith("@") && hasCyrillic(q)) {
    const mapped = mapKeyboardLayout(q, "ruToEn");
    handle = normalizeHandleCandidate(mapped);
  }
  if (handle) return { query: handle, kind: "handle" };

  // ID substring search: allow if user entered enough digits (hyphens are OK).
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 3) return { query: q, kind: "id" };

  return null;
}
