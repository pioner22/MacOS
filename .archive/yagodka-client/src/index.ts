import "./scss/style.css";
import { applySkin, getStoredSkinId } from "./helpers/skin/skin";
import { applyTheme, resolveInitialTheme } from "./helpers/theme/theme";
import { installAppViewportHeightVar } from "./helpers/ui/appViewport";
import { installFancyCaret } from "./helpers/ui/fancyCaret";
import { installEnvironmentAgent } from "./helpers/ui/environmentAgent";
import { recoverFromLazyImportError } from "./app/bootstrap/lazyImportRecovery";
import { runRequiredUpdateGate } from "./app/bootstrap/requiredUpdateGate";

const root = document.getElementById("app");
if (!root) {
  throw new Error("Missing #app");
}
const appRoot = root;

const storedSkin = getStoredSkinId();
applyTheme(resolveInitialTheme(storedSkin));
applySkin(storedSkin);
installAppViewportHeightVar(root);
installFancyCaret();
installEnvironmentAgent(root);

function mountRuntime() {
  void import("./app/mountApp")
    .then(({ mountApp }) => {
      mountApp(appRoot);
      void import("./helpers/pwa/registerServiceWorker")
        .then(({ registerServiceWorker }) => {
          registerServiceWorker();
        })
        .catch(() => {});
    })
    .catch((err) => {
      if (recoverFromLazyImportError(err, "app_mount")) return;
      try {
        appRoot.textContent = "Не удалось загрузить приложение";
      } catch {
        // ignore
      }
    });
}

void runRequiredUpdateGate(appRoot)
  .then(() => {
    mountRuntime();
  })
  .catch(() => {
    mountRuntime();
  });
