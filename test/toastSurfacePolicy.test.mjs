import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(".");

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

test("toast policy: notifications use header status line and never render popup surface", () => {
  const feature = read("src/app/features/ui/toastFeature.ts");
  const renderer = read("src/components/toast/renderToast.ts");
  const header = read("src/components/header/renderHeader.ts");
  const headerCss = read("src/scss/components.part01.css");
  const serviceCss = read("src/scss/service-surfaces.css");
  const toastCss = read("src/scss/toast.css");

  assert.match(feature, /normalizeToastMessage/);
  assert.match(feature, /normalizeToastPlacement/);
  assert.match(feature, /clean\.length <= 160/);
  assert.match(feature, /store\.set\(\{\s*status:\s*msg,\s*toast\s*\}\)/);
  assert.match(feature, /document\.addEventListener\("click",\s*onToastClick,\s*true\)/);
  assert.match(renderer, /host\.classList\.add\("hidden"\)/);
  assert.match(renderer, /host\.removeAttribute\("data-toast-placement"\)/);
  assert.doesNotMatch(renderer, /data-toast-placement",\s*"status"/);
  assert.match(header, /hdr-status-action/);
  assert.match(header, /role:\s*"status"/);
  assert.match(header, /data-status-tone/);
  assert.match(headerCss, /\.hdr-status-actions\b/);
  assert.match(headerCss, /\.hdr-right:not\(\[data-status-empty="1"\]\)\s+\.hdr-status::before/);
  assert.match(serviceCss, /\.toast-host\s*\{[\s\S]*display:\s*none\s*!important;[\s\S]*pointer-events:\s*none\s*!important;/);
  assert.match(toastCss, /\.toast-host,\s*\.toast\s*\{[\s\S]*display:\s*none\s*!important;[\s\S]*pointer-events:\s*none\s*!important;/);
  assert.doesNotMatch(toastCss, /toast-dismiss/);
});
