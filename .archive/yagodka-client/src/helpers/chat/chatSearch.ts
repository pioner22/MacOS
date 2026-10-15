import { extractSearchQueryFilters, type SearchQueryFilters } from "../search/searchQueryFilters";

export type ChatSearchFilter = "all" | "media" | "files" | "links" | "music" | "voice";

export interface ChatSearchFlags {
  media?: boolean;
  files?: boolean;
  links?: boolean;
  music?: boolean;
  voice?: boolean;
}

export interface ChatSearchableMessage {
  text?: string | null;
  attachmentName?: string | null;
  senderTokens?: string | null;
  flags?: ChatSearchFlags;
}

export interface ChatSearchCounts {
  all: number;
  media: number;
  files: number;
  links: number;
  music: number;
  voice: number;
}

export const CHAT_SEARCH_FILTERS: Array<{ id: ChatSearchFilter; label: string }> = [
  { id: "all", label: "Все" },
  { id: "media", label: "Медиа" },
  { id: "files", label: "Файлы" },
  { id: "links", label: "Ссылки" },
  { id: "music", label: "Музыка" },
  { id: "voice", label: "Голос" },
];

function norm(input: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function matchesFilter(flags: ChatSearchFlags | undefined, filter: ChatSearchFilter): boolean {
  if (filter === "all") return true;
  if (!flags) return false;
  return Boolean(flags[filter]);
}

function matchesHashtags(text: string, hashtags: string[]): boolean {
  if (!hashtags.length) return true;
  const hay = String(text || "").toLowerCase();
  return hashtags.every((tag) => hay.includes(`#${tag}`));
}

function matchesQuery(message: ChatSearchableMessage, filters: SearchQueryFilters): boolean {
  const qText = norm(filters.text);
  const from = norm(filters.from);
  const hashtags = filters.hashtags;
  if (!qText && !from && !hashtags.length) return false;

  if (qText) {
    const hay = norm(`${message.text || ""} ${message.attachmentName || ""}`);
    if (!hay || !hay.includes(qText)) return false;
  }

  if (from) {
    const sender = norm(message.senderTokens || "");
    if (!sender || !sender.includes(from)) return false;
  }

  if (hashtags.length && !matchesHashtags(message.text || "", hashtags)) return false;
  return true;
}

export function createChatSearchCounts(): ChatSearchCounts {
  return { all: 0, media: 0, files: 0, links: 0, music: 0, voice: 0 };
}

export function computeChatSearchCounts(messages: ChatSearchableMessage[], query: string): ChatSearchCounts {
  const filters = extractSearchQueryFilters(query);
  const qText = norm(filters.text);
  const from = norm(filters.from);
  const hashtags = filters.hashtags;
  const counts = createChatSearchCounts();
  if (!qText && !from && !hashtags.length) return counts;
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i] || {};
    if (!matchesQuery(m, filters)) continue;
    counts.all += 1;
    if (m.flags?.media) counts.media += 1;
    if (m.flags?.files) counts.files += 1;
    if (m.flags?.links) counts.links += 1;
    if (m.flags?.music) counts.music += 1;
    if (m.flags?.voice) counts.voice += 1;
  }
  return counts;
}

export function computeChatSearchHits(messages: ChatSearchableMessage[], query: string, filter: ChatSearchFilter = "all"): number[] {
  const filters = extractSearchQueryFilters(query);
  const qText = norm(filters.text);
  const from = norm(filters.from);
  const hashtags = filters.hashtags;
  if (!qText && !from && !hashtags.length) return [];
  const out: number[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i] || {};
    if (!matchesQuery(m, filters)) continue;
    if (!matchesFilter(m.flags, filter)) continue;
    out.push(i);
  }
  return out;
}

export function clampChatSearchPos(hits: number[], pos: number): number {
  if (!hits.length) return 0;
  const p = Number.isFinite(pos) ? Math.trunc(pos) : 0;
  if (p < 0) return 0;
  if (p >= hits.length) return hits.length - 1;
  return p;
}

export function stepChatSearchPos(hits: number[], pos: number, dir: 1 | -1): number {
  if (!hits.length) return 0;
  const p = clampChatSearchPos(hits, pos);
  const next = (p + dir + hits.length) % hits.length;
  return next;
}
