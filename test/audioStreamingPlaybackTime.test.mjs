import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";

async function readSrc(relPath) {
  return await readFile(path.resolve(relPath), "utf8");
}

test("audio streaming playback: voice timers keep moving without known duration", async () => {
  const runtimeSrc = await readSrc("src/app/features/navigation/chatSurfaceMediaRuntime.ts");
  assert.match(runtimeSrc, /if\s*\(duration\s*>\s*0\)\s*\{/);
  assert.match(runtimeSrc, /time\.textContent\s*=\s*formatVoiceTime\(current\)/);
  assert.doesNotMatch(runtimeSrc, /if\s*\(!time\s*\|\|\s*!duration\)\s*return/);

  const deferredSrc = await readSrc("src/components/chat/chatDeferredMediaSurface.ts");
  assert.match(deferredSrc, /if\s*\(Number\.isFinite\(duration\)\s*&&\s*duration\s*>\s*0\)\s*\{/);
  assert.match(deferredSrc, /time\.textContent\s*=\s*formatVoiceTime\(current\)/);
  assert.doesNotMatch(
    deferredSrc,
    /audio\.addEventListener\("timeupdate"[\s\S]{0,180}if\s*\(!Number\.isFinite\(duration\)\s*\|\|\s*duration\s*<=\s*0\)\s*return/
  );
});
