import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadBoardSchedule() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/boards/boardSchedule.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.sanitizeBoardSchedule !== "function") throw new Error("sanitizeBoardSchedule export missing");
    if (typeof mod.maxBoardScheduleDelayMs !== "function") throw new Error("maxBoardScheduleDelayMs export missing");
    return {
      sanitizeBoardSchedule: mod.sanitizeBoardSchedule,
      maxBoardScheduleDelayMs: mod.maxBoardScheduleDelayMs,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("boardSchedule: сортирует и дедуплицирует по id", async () => {
  const { sanitizeBoardSchedule, cleanup } = await loadBoardSchedule();
  const now = 1_700_000_000_000;
  try {
    const out = sanitizeBoardSchedule(
      [
        { id: "a", boardId: "b1", text: "hello", scheduleAt: now + 1000, createdAt: now },
        { id: "a", boardId: "b1", text: "dup", scheduleAt: now + 2000, createdAt: now },
        { id: "b", boardId: "b1", text: "hi", scheduleAt: now + 500, createdAt: now },
      ],
      { nowMs: now }
    );
    assert.deepEqual(
      out.map((x) => x.id),
      ["b", "a"]
    );
  } finally {
    await cleanup();
  }
});

test("boardSchedule: отбрасывает элементы вне окна 7 дней и слишком старые createdAt", async () => {
  const { sanitizeBoardSchedule, maxBoardScheduleDelayMs, cleanup } = await loadBoardSchedule();
  const now = 1_700_000_000_000;
  try {
    const maxDelay = maxBoardScheduleDelayMs();
    const grace = 12 * 60 * 60 * 1000;
    const out = sanitizeBoardSchedule(
      [
        { id: "a", boardId: "b1", text: "too late", scheduleAt: now + maxDelay + 1, createdAt: now },
        { id: "b", boardId: "b1", text: "too old", scheduleAt: now + 1000, createdAt: now - (maxDelay + grace + 1) },
        { id: "c", boardId: "b1", text: "ok", scheduleAt: now + maxDelay, createdAt: now },
      ],
      { nowMs: now }
    );
    assert.deepEqual(
      out.map((x) => x.id),
      ["c"]
    );
  } finally {
    await cleanup();
  }
});

test("boardSchedule: режет длину текста и количество записей", async () => {
  const { sanitizeBoardSchedule, cleanup } = await loadBoardSchedule();
  const now = 1_700_000_000_000;
  try {
    const long = "x".repeat(5000);
    const raw = Array.from({ length: 50 }, (_, i) => ({
      id: `id${i}`,
      boardId: "b1",
      text: long,
      scheduleAt: now + 1000 + i,
      createdAt: now,
    }));
    const out = sanitizeBoardSchedule(raw, { nowMs: now });
    assert.equal(out.length, 40);
    assert.equal(out[0].text.length, 4000);
  } finally {
    await cleanup();
  }
});

