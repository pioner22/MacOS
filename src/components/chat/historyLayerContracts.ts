export type HistoryItemLayerId =
  | "layout"
  | "text"
  | "media"
  | "audio"
  | "date"
  | "system"
  | "interaction"
  | "theme";

export type HistorySystemMessageLayer = "notice" | "action" | "noise";

export type HistoryItemLayerContract = {
  id: HistoryItemLayerId;
  owner: string;
  purpose: string;
  selectors: readonly string[];
};

export const HISTORY_ITEM_LAYER_CONTRACTS: readonly HistoryItemLayerContract[] = [
  {
    id: "layout",
    owner: "chat-lines rail and message row geometry",
    purpose: "Keep the history rail, row spacing, alignment and responsive max-widths stable before item-specific surfaces render.",
    selectors: [".chat:not(.chat-board)", ".chat:not(.chat-board) .chat-lines", ".chat:not(.chat-board) .msg"],
  },
  {
    id: "text",
    owner: "text message bubble surface",
    purpose: "Own text, reply, forward, time and status spacing without leaking into media shells.",
    selectors: [".msg:not(.msg-attach):not(.msg-sys) .msg-body", ".msg-text", ".msg-meta"],
  },
  {
    id: "media",
    owner: "photo, video and album surface",
    purpose: "Own visual preview width, aspect-ratio, caption, media meta and loading overlays without framed-card artifacts.",
    selectors: ['.msg-attach[data-msg-file="image"]', '.msg-attach[data-msg-file="video"]', '.msg-album[data-msg-album="1"]'],
  },
  {
    id: "audio",
    owner: "voice and audio playback row",
    purpose: "Keep waveform rows compact, one-line and independent from file-card styling.",
    selectors: ['.msg-attach[data-msg-file="audio"]', ".file-row-audio", ".chat-voice"],
  },
  {
    id: "date",
    owner: "inline date and unread separators",
    purpose: "Render date pills as non-sticky inline items so lazy history batches cannot create overlapping clouds.",
    selectors: [".msg-date", ".msg-sep-pill", ".msg-unread"],
  },
  {
    id: "system",
    owner: "system, action and noise messages",
    purpose: "Separate real action notices from noisy transport/auth placeholders that should not pollute the history.",
    selectors: [".msg-sys", ".msg-sys-noise", '[data-msg-system-layer="action"]'],
  },
  {
    id: "interaction",
    owner: "selected, hover, context and hit states",
    purpose: "Make interaction states visible without changing message size or triggering history jumps.",
    selectors: [".msg-selected", ".msg-context-active", ".msg-hit-active"],
  },
  {
    id: "theme",
    owner: "light and dark history tokens",
    purpose: "Keep color, border and contrast decisions tokenized so light and dark themes do not diverge structurally.",
    selectors: ['html[data-theme="light"] .chat:not(.chat-board)', 'html[data-theme="dark"] .chat:not(.chat-board)'],
  },
] as const;

function normalizeHistorySystemMessageText(text: string): string {
  return String(text || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function isNoisySystemMessageText(text: string): boolean {
  const normalized = normalizeHistorySystemMessageText(text);
  return (
    normalized === "[blocked] not_authorized" ||
    normalized === "[blocked] unauthorized" ||
    normalized === "not_authorized" ||
    normalized === "unauthorized"
  );
}

export function classifyHistorySystemMessageLayer(text: string, attachmentKind?: string): HistorySystemMessageLayer {
  if (isNoisySystemMessageText(text)) return "noise";
  if (String(attachmentKind || "").trim() === "action") return "action";
  return "notice";
}
