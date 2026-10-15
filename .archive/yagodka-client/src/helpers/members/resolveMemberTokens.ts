import { normalizeMemberToken, type MemberTokenStatus } from "./memberTokens";

export type ResolveMemberTokensResult =
  | { ok: true; members: string[] }
  | { ok: false; reason: "pending"; pending: string[] }
  | { ok: false; reason: "invalid"; invalid: string[] }
  | { ok: false; reason: "missing_handles"; missing: string[] };

export function resolveMemberTokensForSubmit(opts: {
  tokens: string[];
  statusByToken: Map<string, MemberTokenStatus>;
  handleToId: Map<string, string>;
}): ResolveMemberTokensResult {
  const tokens = Array.from(new Set((opts.tokens || []).map((t) => String(t || "").trim()).filter(Boolean)));
  if (!tokens.length) return { ok: true, members: [] };

  const pending: string[] = [];
  const invalid: string[] = [];
  const missing: string[] = [];
  const resolved: string[] = [];

  for (const token of tokens) {
    const status =
      opts.statusByToken.get(token) || (normalizeMemberToken(token)?.kind === "invalid" ? ("invalid" as const) : ("pending" as const));

    if (status === "pending") {
      pending.push(token);
      continue;
    }
    if (status === "bad" || status === "invalid") {
      invalid.push(token);
      continue;
    }

    if (token.startsWith("@")) {
      const id = opts.handleToId.get(token);
      if (!id) missing.push(token);
      else resolved.push(id);
    } else {
      resolved.push(token);
    }
  }

  if (pending.length) return { ok: false, reason: "pending", pending };
  if (invalid.length) return { ok: false, reason: "invalid", invalid };
  if (missing.length) return { ok: false, reason: "missing_handles", missing };

  return { ok: true, members: Array.from(new Set(resolved)) };
}

