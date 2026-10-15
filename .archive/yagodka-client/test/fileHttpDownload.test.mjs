import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadHelper() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  const entry = path.join(tempDir, "entry.ts");
  try {
    await writeFile(
      entry,
      [
        `export { resumableHttpDownload } from ${JSON.stringify(path.resolve("src/helpers/files/fileHttpDownload.ts"))};`,
        `export { rememberFileHttpBearer } from ${JSON.stringify(path.resolve("src/helpers/files/fileHttpAuth.ts"))};`,
      ].join("\n"),
      "utf8",
    );
    await build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.resumableHttpDownload !== "function") throw new Error("missing export: resumableHttpDownload");
    if (typeof mod.rememberFileHttpBearer !== "function") throw new Error("missing export: rememberFileHttpBearer");
    return {
      resumableHttpDownload: mod.resumableHttpDownload,
      rememberFileHttpBearer: mod.rememberFileHttpBearer,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

function streamFromChunks(chunks, { failAfter = null } = {}) {
  let idx = 0;
  return new ReadableStream({
    pull(controller) {
      if (failAfter !== null && idx >= failAfter) {
        controller.error(new Error("boom"));
        return;
      }
      if (idx >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[idx]);
      idx += 1;
    },
  });
}

test("fileHttpDownload: докачивает через Range после обрыва stream", async () => {
  const { resumableHttpDownload, rememberFileHttpBearer, cleanup } = await loadHelper();
  try {
    const enc = new TextEncoder();
    const calls = [];
    const parts = [];
    const fetchFn = async (input, init) => {
      calls.push({ url: String(input), headers: init?.headers || {} });
      if (calls.length === 1) {
        const body = streamFromChunks([enc.encode("ab")], { failAfter: 1 });
        return new Response(body, {
          status: 200,
          headers: { "Content-Length": "6", ETag: '"6-1"' },
        });
      }
      const hdrs = init?.headers || {};
      assert.equal(hdrs.Range, "bytes=2-");
      assert.equal(hdrs["If-Range"], '"6-1"');
      const body = streamFromChunks([enc.encode("cdef")]);
      return new Response(body, {
        status: 206,
        headers: { "Content-Range": "bytes 2-5/6", ETag: '"6-1"' },
      });
    };

    rememberFileHttpBearer("http://x/files/f1", "1");
    const res = await resumableHttpDownload({
      url: "http://x/files/f1",
      fetchFn,
      sleep: async () => {},
      baseDelayMs: 1,
      maxDelayMs: 1,
      onChunk: (chunk) => parts.push(Buffer.from(chunk).toString("utf8")),
    });
    assert.equal(res.received, 6);
    assert.equal(res.total, 6);
    assert.equal(parts.join(""), "abcdef");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "http://x/files/f1");
    assert.equal(calls[0].headers.Authorization, "Bearer 1");
    assert.equal(calls[1].url, "http://x/files/f1");
    assert.equal(calls[1].headers.Authorization, "Bearer 1");
  } finally {
    await cleanup();
  }
});

test("fileHttpDownload: onReset очищает буфер при игноре Range (200 вместо 206)", async () => {
  const { resumableHttpDownload, cleanup } = await loadHelper();
  try {
    const enc = new TextEncoder();
    const parts = ["xx"];
    const resetReasons = [];
    const fetchFn = async () => {
      const body = streamFromChunks([enc.encode("abcdef")]);
      return new Response(body, { status: 200, headers: { "Content-Length": "6", ETag: '"6-2"' } });
    };

    const res = await resumableHttpDownload({
      url: "http://x/files/f1",
      offset: 2,
      etag: '"6-1"',
      fetchFn,
      sleep: async () => {},
      baseDelayMs: 1,
      maxDelayMs: 1,
      onReset: (reason) => {
        resetReasons.push(reason);
        parts.length = 0;
      },
      onChunk: (chunk) => parts.push(Buffer.from(chunk).toString("utf8")),
    });
    assert.equal(res.received, 6);
    assert.equal(res.total, 6);
    assert.deepEqual(resetReasons, ["range_ignored"]);
    assert.equal(parts.join(""), "abcdef");
  } finally {
    await cleanup();
  }
});

test("fileHttpDownload: refreshUrl используется при 403", async () => {
  const { resumableHttpDownload, rememberFileHttpBearer, cleanup } = await loadHelper();
  try {
    const calls = [];
    const fetchFn = async (input, init) => {
      calls.push({ url: String(input), headers: init?.headers || {} });
      if (calls.length === 1) return new Response(null, { status: 403 });
      return new Response(new TextEncoder().encode("ok"), { status: 200, headers: { "Content-Length": "2" } });
    };
    const parts = [];
    rememberFileHttpBearer("http://x/files/f1", "bad");
    const res = await resumableHttpDownload({
      url: "http://x/files/f1",
      fetchFn,
      sleep: async () => {},
      baseDelayMs: 1,
      maxDelayMs: 1,
      maxUrlRefresh: 1,
      refreshUrl: async () => {
        rememberFileHttpBearer("http://x/files/f1", "good");
        return "http://x/files/f1";
      },
      onChunk: (chunk) => parts.push(Buffer.from(chunk).toString("utf8")),
    });
    assert.equal(res.received, 2);
    assert.equal(parts.join(""), "ok");
    assert.deepEqual(calls, [
      { url: "http://x/files/f1", headers: { Authorization: "Bearer bad" } },
      { url: "http://x/files/f1", headers: { Authorization: "Bearer good" } },
    ]);
  } finally {
    await cleanup();
  }
});
