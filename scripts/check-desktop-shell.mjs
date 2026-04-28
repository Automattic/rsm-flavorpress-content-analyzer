import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const tauriConfigPath = resolve(root, "apps/desktop/src-tauri/tauri.conf.json");
const defaultCapabilityPath = resolve(root, "apps/desktop/src-tauri/capabilities/default.json");
const iconPath = resolve(root, "apps/desktop/src-tauri/icons/icon.png");
const appSourcePath = resolve(root, "apps/desktop/src/App.tsx");
const uiSourcePath = resolve(root, "apps/desktop/src/ui.tsx");
const stylesPath = resolve(root, "apps/desktop/src/styles.css");

const requiredDragPermission = "core:window:allow-start-dragging";

function fail(message) {
  throw new Error(message);
}

function readText(path) {
  if (!existsSync(path)) {
    fail(`Missing required desktop shell file: ${path}`);
  }
  return readFileSync(path, "utf8");
}

function readJson(path) {
  try {
    return JSON.parse(readText(path));
  } catch (error) {
    fail(`Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const tauriConfig = readJson(tauriConfigPath);
const firstWindow = Array.isArray(tauriConfig?.app?.windows) ? tauriConfig.app.windows[0] : null;
if (!firstWindow) {
  fail("Tauri config must declare app.windows[0].");
}
if (firstWindow.titleBarStyle !== "Overlay") {
  fail(`Tauri app.windows[0].titleBarStyle must be Overlay. Received: ${String(firstWindow.titleBarStyle)}`);
}
if (firstWindow.hiddenTitle !== true) {
  fail("Tauri app.windows[0].hiddenTitle must be true.");
}
if (firstWindow.decorations === false) {
  fail("Tauri app.windows[0].decorations=false is not allowed; keep native window controls.");
}
if (typeof firstWindow.backgroundColor !== "string" || !/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(firstWindow.backgroundColor)) {
  fail("Tauri app.windows[0].backgroundColor must be a #RRGGBB or #RRGGBBAA value.");
}

const declaredCapabilities = Array.isArray(tauriConfig?.app?.security?.capabilities)
  ? tauriConfig.app.security.capabilities
  : [];
if (!declaredCapabilities.includes("default")) {
  fail("Tauri app.security.capabilities must include default.");
}

const defaultCapability = readJson(defaultCapabilityPath);
const permissions = Array.isArray(defaultCapability?.permissions) ? defaultCapability.permissions : [];
if (!permissions.includes(requiredDragPermission)) {
  fail(`Desktop default capability must include ${requiredDragPermission}.`);
}

const icon = readFileSync(iconPath);
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
if (icon.length < pngSignature.length || !icon.subarray(0, pngSignature.length).equals(pngSignature)) {
  fail("Desktop icon must be a valid PNG file.");
}

const appSource = readText(appSourcePath);
for (const snippet of ["src-tauri/icons/icon.png?url", "src={appIconUrl}", "onError={() => setAppIconAvailable(false)}"]) {
  if (!appSource.includes(snippet)) {
    fail(`Desktop app source is missing shell icon marker: ${snippet}`);
  }
}

const uiSource = readText(uiSourcePath);
for (const snippet of ["startDragging", "data-tauri-drag-region", "windowDragNoDragSelector", "onMouseDownCapture"]) {
  if (!uiSource.includes(snippet)) {
    fail(`Desktop shell source is missing drag marker: ${snippet}`);
  }
}

const styles = readText(stylesPath);
for (const snippet of [
  "app-region: drag",
  "-webkit-app-region: drag",
  "app-region: no-drag",
  "-webkit-app-region: no-drag",
  "--desktop-brand-padding-top: 0.64rem",
  "--desktop-brand-padding-right: 0.72rem",
  "justify-content: flex-end",
  "align-items: flex-start",
]) {
  if (!styles.includes(snippet)) {
    fail(`Desktop shell styles are missing marker: ${snippet}`);
  }
}

console.log("Desktop shell guard passed.");
