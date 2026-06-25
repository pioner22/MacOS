export type SearchQueryFilters = {
  text: string;
  from: string;
  hashtags: string[];
};

const SEARCH_FILTER_FROM_RE = /^(from|от):(.+)$/i;
const SEARCH_FILTER_TAG_RE = /^#([a-z0-9_а-яё-]{1,64})$/i;

export function extractSearchQueryFilters(raw: string): SearchQueryFilters {
  const tokens = String(raw ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const rest: string[] = [];
  const hashtags = new Set<string>();
  let from = "";
  for (const token of tokens) {
    const fromMatch = token.match(SEARCH_FILTER_FROM_RE);
    if (fromMatch) {
      const value = String(fromMatch[2] || "").trim();
      if (value && !from) {
        from = value;
        continue;
      }
    }
    const tagMatch = token.match(SEARCH_FILTER_TAG_RE);
    if (tagMatch) {
      const tag = String(tagMatch[1] || "").trim().toLowerCase();
      if (tag) hashtags.add(tag);
      continue;
    }
    rest.push(token);
  }
  return { text: rest.join(" "), from, hashtags: Array.from(hashtags) };
}

export function buildPivotSearchQuery(filters: SearchQueryFilters): string {
  const parts: string[] = [];
  if (filters.text) parts.push(filters.text);
  if (filters.from) parts.push(`from:${filters.from}`);
  if (filters.hashtags.length) parts.push(...filters.hashtags.map((tag) => `#${tag}`));
  return parts.join(" ").trim();
}
