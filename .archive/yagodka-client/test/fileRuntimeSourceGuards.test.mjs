import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";

async function readSrc(relPath) {
  return await readFile(path.resolve(relPath), "utf8");
}

test("file runtime: features route shared prefetch policy and HTTP queue ownership through dedicated helpers", async () => {
  const fileGetSrc = await readSrc("src/app/features/files/fileGetFeature.ts");
  assert.match(fileGetSrc, /resolveFileGetEnqueuePolicy/);
  assert.match(fileGetSrc, /canDrainFilePrefetch/);

  const previewSrc = await readSrc("src/app/features/files/previewAutoFetchFeature.ts");
  assert.match(previewSrc, /isFileRuntimeDocumentVisible/);
  assert.match(previewSrc, /canDrainFilePrefetch/);

  const fileDownloadSrc = await readSrc("src/app/features/files/fileDownloadFeature.ts");
  assert.match(fileDownloadSrc, /createFileHttpDownloadRuntime/);
  assert.doesNotMatch(fileDownloadSrc, /const httpQueueHigh = \[\]/);
  assert.doesNotMatch(fileDownloadSrc, /const httpQueuePrefetch = \[\]/);

  const httpRuntimeSrc = await readSrc("src/app/features/files/fileHttpDownloadRuntime.ts");
  assert.match(httpRuntimeSrc, /promoteUserRequestedPrefetchToHigh/);
  assert.match(httpRuntimeSrc, /canDrainFilePrefetch/);

  const bootstrapSrc = await readSrc("src/app/features/files/fileTransferBootstrap.ts");
  assert.match(bootstrapSrc, /isBlockingFileDownloadState/);
});
