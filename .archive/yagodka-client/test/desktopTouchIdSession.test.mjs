import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(".");

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

test("desktop Touch ID unlock is exposed through preload and guarded in main", () => {
  const main = read("desktop/main.cjs");
  const preload = read("desktop/preload.cjs");
  const session = read("src/helpers/auth/session.ts");
  const authFeature = read("src/app/features/auth/authFeature.ts");
  const authModal = read("src/components/modals/renderAuthModal.ts");

  assert.match(main, /safeStorage/);
  assert.match(main, /systemPreferences/);
  assert.match(main, /canPromptTouchID/);
  assert.match(main, /promptTouchID/);
  assert.match(main, /yagodka:secure-session-save/);
  assert.match(main, /yagodka:secure-session-unlock/);

  assert.match(preload, /saveSessionToken/);
  assert.match(preload, /unlockSession/);
  assert.match(preload, /clearSessionToken/);
  assert.match(preload, /features/);

  assert.match(session, /canUseDesktopBiometricUnlock/);
  assert.match(session, /unlockDesktopBiometricSession/);
  assert.match(session, /saveSessionToken/);
  assert.match(session, /clearSessionToken/);

  assert.match(authFeature, /authTouchIdFromDom/);
  assert.match(authModal, /Touch ID/);
});
