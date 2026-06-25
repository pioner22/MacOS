import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("search parity: global search uses pivot query builder and active-tab visibility helper", async () => {
  const src = await readFile(path.resolve("src/pages/search/createSearchPage.ts"), "utf8");
  assert.match(src, /buildPivotSearchQuery\(filters\)/);
  assert.match(src, /keepActiveControlVisible\(tabsBar, "\.search-tab\.is-active"\)/);
  assert.match(src, /keepActiveControlVisible\(filterBar, "\.search-filter\.is-active"\)/);
});

test("search page polish: global search keeps the modern shell and compact result cards", async () => {
  const pageSrc = await readFile(path.resolve("src/pages/search/createSearchPage.ts"), "utf8");
  const cssSrc = await readFile(path.resolve("src/scss/pages.css"), "utf8");
  assert.match(pageSrc, /class: "search-shell"/);
  assert.match(pageSrc, /class: "search-field"/);
  assert.match(pageSrc, /class: "btn search-clear hidden"/);
  assert.match(pageSrc, /class: "btn search-submit"/);
  assert.doesNotMatch(pageSrc, /class: "chat-title" \}, \["Поиск"\]/);
  assert.match(cssSrc, /\.page-search \.search-shell/);
  assert.match(cssSrc, /\.page-search \.search-field:focus-within/);
  assert.match(cssSrc, /\.page-search \.search-input:focus/);
  assert.match(cssSrc, /border-radius:\s*999px;/);
  assert.match(cssSrc, /\.page-search \.result-item/);
  assert.match(cssSrc, /\.page-search \.page-actions \.btn/);
});

test("search parity: chat search uses active-filter visibility helper", async () => {
  const src = await readFile(path.resolve("src/components/chat/renderChat.ts"), "utf8");
  assert.match(src, /keepActiveControlVisible\(searchBar, "\.chat-search-filter\.is-active"\)/);
});
